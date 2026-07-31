/**
 * Historical review pass ("backfill").
 *
 * Operators need to know how the CURRENT rulebook would have graded the last
 * few days, without waiting days for live ticks. This replays the stored
 * candle history bar by bar and writes graded candidates to the journal.
 *
 * Two hard boundaries make it safe to run beside the live pipeline:
 *
 *   1. It reads ONLY the durable candle store. It never calls the market-data
 *      provider, so it cannot compete for the single provider resource slot
 *      that starved context and precision in the past.
 *   2. It is journal-only. Every row is written with `shadow_mode = true`, it
 *      never promotes a signal, never opens a precision watch, and never
 *      delivers a notification on any channel.
 *
 * Throttling is explicit and configurable: a per-tick bar cap, a per-tick time
 * budget, and a stored cursor so a long window is completed across many short
 * slices instead of one long run that would overrun a lock.
 */

import type { Bias, Candle, GateResult, Rulebook, Timeframe } from "./types";
import {
  TIMEFRAME_LABEL,
  TIMEFRAME_SECONDS,
  armingDisplacementFor,
  precisionRulesFor,
} from "./types";
import { atr } from "./atr.server";
import { higherTimeframeBias } from "./bias.server";
import { evaluateBiasPolicy, biasPolicyGate } from "./bias-policy.server";
import { detectSetupDetailed, type SetupResult } from "./setups.server";
import { entryAnchorForSetup } from "./entry-anchor.server";
import { buildExecutionZone, calculateAdaptiveZoneWidthPoints } from "./entry-zone.server";
import { buildInvalidation, hasInvalidation } from "./invalidation.server";
import { invalidStop, invalidationGate, noSetup, sessionGate } from "./gates.server";
import { checkLateEntry } from "./late-entry.server";
import { pointSizeFor } from "./pips.server";
import { rewardToRisk, structuralTargets } from "./risk.server";
import { minTierRr, scoreCandidate } from "./scoring.server";
import { sessionAt } from "./sessions.server";
import { swingHighs, swingLows } from "./swings.server";
import { resolveSymbol, roundToDigits, type InstrumentRow } from "./symbols.server";
import { isArmableSetup } from "./run.server";
import { fingerprint } from "./fingerprint.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const BACKFILL_LOCK_KEY = "backfill-scan";
const ENTRY_TF: Timeframe = "M15";
/** History retention is 14 days, so a longer window has no data behind it. */
export const MAX_BACKFILL_DAYS = 14;
/** Bars of context each replayed bar needs before it can be judged. */
const WARMUP_BARS = 80;

export type BackfillSettings = {
  days: number;
  maxBarsPerTick: number;
  budgetMs: number;
  cursor: BackfillCursor;
};

export type BackfillCursor = {
  /** Canonical symbol currently being replayed. */
  instrument?: string | null;
  /** Exclusive lower bound — the next bar to judge opens after this. */
  afterBarTime?: string | null;
  /** Window start, pinned when the run began so it cannot drift. */
  windowStart?: string | null;
  days?: number | null;
  completedAt?: string | null;
};

export function clampBackfillSettings(row: {
  backfill_days?: number | null;
  backfill_max_bars_per_tick?: number | null;
  backfill_budget_ms?: number | null;
  backfill_cursor?: unknown;
}): BackfillSettings {
  const cursor =
    row.backfill_cursor && typeof row.backfill_cursor === "object"
      ? (row.backfill_cursor as BackfillCursor)
      : {};
  return {
    days: Math.max(0, Math.min(MAX_BACKFILL_DAYS, Math.trunc(row.backfill_days ?? 0))),
    // The throttle: never more than this many bars, never longer than the
    // budget. Both are clamped so a bad value cannot wedge a tick.
    maxBarsPerTick: Math.max(10, Math.min(2000, Math.trunc(row.backfill_max_bars_per_tick ?? 250))),
    budgetMs: Math.max(2_000, Math.min(40_000, Math.trunc(row.backfill_budget_ms ?? 12_000))),
    cursor,
  };
}

async function readWindow(
  admin: Admin,
  brokerSymbol: string,
  timeframe: Timeframe,
  fromIso: string,
): Promise<Candle[]> {
  const { data, error } = await admin
    .from("market_candles")
    .select("open_time, open, high, low, close, volume")
    .eq("broker_symbol", brokerSymbol)
    .eq("timeframe", TIMEFRAME_LABEL[timeframe])
    .gte("open_time", fromIso)
    .order("open_time", { ascending: true })
    .limit(5000);
  if (error) {
    console.error("backfill candle read failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    time: new Date(row.open_time as string).toISOString(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume === null ? null : Number(row.volume),
  }));
}

/** Everything at or before `asOf`. History is replayed with no lookahead. */
function upTo(candles: Candle[], asOfMs: number): Candle[] {
  return candles.filter((c) => Date.parse(c.time) <= asOfMs);
}

export type ReplayedBar = {
  barTime: string;
  candidate: Record<string, unknown> | null;
};

/**
 * Grades ONE historical entry bar. Time-of-evaluation gates (stale data, live
 * spread, duplicate-today, news lockout) are deliberately absent: they judge
 * the live feed, not history, and asserting them against the past would be
 * inventing data. Session is evaluated at the bar's own timestamp.
 */
export function gradeHistoricalBar(args: {
  instrument: InstrumentRow;
  brokerSymbol: string;
  digits: number | null;
  rulebook: Rulebook;
  entry: Candle[];
  m5: Candle[];
  h4: Candle[];
  d1: Candle[];
}): {
  gates: GateResult[];
  candidate: null | {
    direction: "LONG" | "SHORT";
    setupType: string;
    bias: Bias;
    entryLow: number | null;
    entryHigh: number | null;
    stop: number | null;
    targets: number[];
    rr: number | null;
    atr: number | null;
    score: number | null;
    grade: "A_PLUS" | "A" | "B" | "C" | null;
    components: Record<string, number>;
    qualified: boolean;
    barTime: string;
    fingerprint: string;
  };
} {
  const { instrument, rulebook, entry, m5, h4, d1, digits } = args;
  const gates: GateResult[] = [];
  const last = entry.at(-1);
  if (!last) return { gates, candidate: null };

  const barDate = new Date(Date.parse(last.time) + TIMEFRAME_SECONDS[ENTRY_TF] * 1000);
  const allowedSessions =
    instrument.sessions && instrument.sessions.length > 0
      ? instrument.sessions
      : rulebook.allowed_sessions;
  gates.push(sessionGate(sessionAt(barDate), allowedSessions));

  const atrValue = atr(entry, rulebook.atr_period, rulebook.atr_method);
  const { bias, d1: d1Bias } = higherTimeframeBias(h4, d1, rulebook.swing_lookback);
  const armingThreshold = armingDisplacementFor(rulebook, instrument.symbol);

  const detection = detectSetupDetailed(
    {
      candles: entry,
      atr: atrValue,
      bias: bias as Bias,
      swingLookback: rulebook.swing_lookback,
      displacementMinAtr: rulebook.displacement_min_atr,
    },
    (candidate) => isArmableSetup(candidate, rulebook, instrument.symbol),
  );
  const setup = detection.selected;
  if (!setup || !isArmableSetup(setup, rulebook, instrument.symbol)) {
    gates.push(
      noSetup(false, setup?.setupType ?? "SWEEP_DISPLACEMENT_RETEST", {
        replay: true,
        bar_time: last.time,
        arming_displacement_min_atr: armingThreshold,
      }),
    );
    return { gates, candidate: null };
  }
  gates.push(noSetup(true, setup.setupType, { replay: true, bar_time: last.time }));

  const direction: "LONG" | "SHORT" = setup.direction ?? (bias === "SHORT" ? "SHORT" : "LONG");
  const precisionRules = precisionRulesFor(rulebook, instrument.symbol);
  const point = pointSizeFor(instrument.point_size ?? null, digits) ?? 0;
  const anchor = entryAnchorForSetup(setup as SetupResult, entry);
  const atrM5 = atr(m5, rulebook.atr_period, rulebook.atr_method) ?? 0;
  const zoneWidthPoints = calculateAdaptiveZoneWidthPoints({
    spreadPoints: 0,
    atrM1: 0,
    atrM5,
    point,
    minimumWidthPoints: precisionRules.min,
    maximumWidthPoints: precisionRules.max,
    spreadMultiplier: precisionRules.spreadMult,
    atrM1Multiplier: precisionRules.atrM1,
    atrM5Multiplier: precisionRules.atrM5,
  });
  const zone =
    anchor.anchor !== null
      ? buildExecutionZone({
          preferredEntry: anchor.anchor,
          direction,
          zoneWidthPoints,
          point,
        })
      : null;

  const entryLow = roundToDigits(zone ? zone.entryLow : setup.entryLow, digits);
  const entryHigh = roundToDigits(zone ? zone.entryHigh : setup.entryHigh, digits);
  const entryPrice =
    roundToDigits(zone ? zone.preferredEntry : null, digits) ??
    (entryLow !== null && entryHigh !== null ? (entryLow + entryHigh) / 2 : null);

  const invalidation = buildInvalidation({
    direction,
    extreme: setup.extreme,
    level: setup.level,
    timeframe: TIMEFRAME_LABEL[ENTRY_TF],
    digits,
  });
  gates.push(invalidationGate(hasInvalidation(invalidation), invalidation.condition));

  const stop = roundToDigits(
    setup.extreme !== null && atrValue
      ? direction === "LONG"
        ? setup.extreme - atrValue * 0.2
        : setup.extreme + atrValue * 0.2
      : null,
    digits,
  );

  gates.push(
    biasPolicyGate(
      evaluateBiasPolicy({
        setup: setup as SetupResult,
        direction,
        bias: bias as Bias,
        d1: d1Bias as Bias,
        rulebook,
      }),
    ),
  );
  gates.push(invalidStop(entryPrice, stop, direction, atrValue, rulebook.max_stop_atr_multiple));

  const opposingLevels = (
    direction === "LONG"
      ? swingHighs(entry, rulebook.swing_lookback)
      : swingLows(entry, rulebook.swing_lookback)
  ).map((s) => s.price);

  const targets =
    entryPrice !== null && stop !== null
      ? structuralTargets({
          entry: entryPrice,
          stop,
          direction,
          levels: opposingLevels,
          atr: atrValue,
          minRr: minTierRr(rulebook),
          fallbackMultiples: [2, 3, 4],
        }).map((t) => roundToDigits(Number(t.toFixed(6)), digits) as number)
      : [];
  const rrRaw = targets.length > 0 ? rewardToRisk(entryPrice, stop, targets[0]) : null;
  const rr = rrRaw === null ? null : Number(rrRaw.toFixed(2));
  const late = checkLateEntry(
    last.close,
    entryLow,
    entryHigh,
    atrValue,
    rulebook.late_entry_max_atr_from_entry,
  );

  const { score, grade, components } = scoreCandidate(
    {
      rr,
      biasAligned: bias === direction,
      d1Aligned: d1Bias === direction,
      displacementAtr: setup.displacementAtr,
      sweepFound: setup.sweepFound || setup.structureType !== null,
      retestFound: setup.retestFound,
      spreadRatio: null,
      lateDistanceAtr: late.distanceAtr,
      macroAligned: true,
    },
    rulebook,
  );

  const qualified = gates.every((g) => g.passed);

  return {
    gates,
    candidate: {
      direction,
      setupType: setup.setupType,
      bias: bias as Bias,
      entryLow,
      entryHigh,
      stop,
      targets,
      rr,
      atr: atrValue,
      score,
      grade,
      components,
      qualified,
      barTime: last.time,
      fingerprint: fingerprint({
        instrument: instrument.symbol,
        direction,
        setupType: setup.setupType,
        timeframe: TIMEFRAME_LABEL[ENTRY_TF],
        tradingDayUtc: last.time.slice(0, 10),
        entry: entryPrice,
        stop,
        atr: atrValue,
      }),
    },
  };
}

export type BackfillResult = {
  ran: boolean;
  reason?: string;
  instrument?: string | null;
  barsJudged: number;
  candidatesWritten: number;
  windowStart?: string | null;
  cursor: BackfillCursor;
  complete: boolean;
  durationMs: number;
};

/**
 * One throttled slice of the historical review. Returns as soon as either the
 * bar cap or the time budget is reached, saving a cursor so the next tick
 * resumes exactly where this one stopped.
 */
export async function runBackfillSlice(
  admin: Admin,
  rulebook: Rulebook,
  settings: BackfillSettings,
  options: { now?: Date } = {},
): Promise<BackfillResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();

  if (settings.days <= 0) {
    return {
      ran: false,
      reason: "Historical review is switched off.",
      barsJudged: 0,
      candidatesWritten: 0,
      cursor: settings.cursor,
      complete: true,
      durationMs: 0,
    };
  }

  const { data: instrumentRows } = await admin
    .from("instruments")
    .select("*")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  const instruments = (instrumentRows ?? []) as unknown as InstrumentRow[];
  if (instruments.length === 0) {
    return {
      ran: false,
      reason: "No enabled instruments.",
      barsJudged: 0,
      candidatesWritten: 0,
      cursor: settings.cursor,
      complete: true,
      durationMs: Date.now() - startedAt,
    };
  }

  // A window is pinned once, so changing the clock mid-run cannot shift it.
  const sameRun =
    settings.cursor.days === settings.days && Boolean(settings.cursor.windowStart);
  const windowStart = sameRun
    ? settings.cursor.windowStart!
    : new Date(now.getTime() - settings.days * 86_400_000).toISOString();

  if (sameRun && settings.cursor.completedAt) {
    return {
      ran: false,
      reason: "Historical review already completed for this window.",
      barsJudged: 0,
      candidatesWritten: 0,
      windowStart,
      cursor: settings.cursor,
      complete: true,
      durationMs: Date.now() - startedAt,
    };
  }

  const startIndex = sameRun
    ? Math.max(
        0,
        instruments.findIndex((i) => i.symbol === settings.cursor.instrument),
      )
    : 0;
  let afterBarTime = sameRun ? (settings.cursor.afterBarTime ?? null) : null;

  let barsJudged = 0;
  let candidatesWritten = 0;
  const deadline = startedAt + settings.budgetMs;

  for (let index = startIndex; index < instruments.length; index += 1) {
    const instrument = instruments[index]!;
    const resolved = await resolveSymbol(instrument);
    const brokerSymbol = resolved.broker;

    // Warm-up history sits BEFORE the window so the first replayed bar has the
    // same amount of context every later bar has.
    const warmupFrom = new Date(
      Date.parse(windowStart) - WARMUP_BARS * TIMEFRAME_SECONDS[ENTRY_TF] * 1000,
    ).toISOString();
    const [entryAll, m5All, h4All, d1All] = await Promise.all([
      readWindow(admin, brokerSymbol, ENTRY_TF, warmupFrom),
      readWindow(admin, brokerSymbol, "M5", warmupFrom),
      readWindow(admin, brokerSymbol, "4h", new Date(Date.parse(warmupFrom) - 30 * 86_400_000).toISOString()),
      readWindow(admin, brokerSymbol, "1d", new Date(Date.parse(warmupFrom) - 200 * 86_400_000).toISOString()),
    ]);

    const minBars = rulebook.atr_period + 2;
    const rows: Array<Record<string, unknown>> = [];

    for (let i = 0; i < entryAll.length; i += 1) {
      const bar = entryAll[i]!;
      const barMs = Date.parse(bar.time);
      if (barMs < Date.parse(windowStart)) continue;
      if (afterBarTime && barMs <= Date.parse(afterBarTime)) continue;
      if (i + 1 < minBars) continue;

      if (barsJudged >= settings.maxBarsPerTick || Date.now() >= deadline) {
        if (rows.length > 0) {
          candidatesWritten += await writeCandidates(admin, rows, rulebook);
        }
        return {
          ran: true,
          instrument: instrument.symbol,
          barsJudged,
          candidatesWritten,
          windowStart,
          cursor: {
            instrument: instrument.symbol,
            afterBarTime,
            windowStart,
            days: settings.days,
            completedAt: null,
          },
          complete: false,
          durationMs: Date.now() - startedAt,
        };
      }

      const graded = gradeHistoricalBar({
        instrument,
        brokerSymbol,
        digits: resolved.digits,
        rulebook,
        entry: entryAll.slice(0, i + 1),
        m5: upTo(m5All, barMs),
        h4: upTo(h4All, barMs),
        d1: upTo(d1All, barMs),
      });
      barsJudged += 1;
      afterBarTime = bar.time;

      // Only armable structure is journalled. Writing a row for every quiet
      // bar would bury the graded ones under tens of thousands of no-ops.
      if (graded.candidate) {
        const c = graded.candidate;
        rows.push({
          scanner_run_id: null,
          instrument: instrument.symbol,
          broker_symbol: brokerSymbol,
          timeframe: TIMEFRAME_LABEL[ENTRY_TF],
          direction: c.direction,
          setup_type: c.setupType,
          bias: c.bias,
          entry_zone_low: c.entryLow,
          entry_zone_high: c.entryHigh,
          stop_loss: c.stop,
          targets: c.targets,
          rr_tp1: c.rr,
          atr: c.atr,
          spread: null,
          score: c.score,
          grade: c.grade,
          score_components: c.components,
          gate_results: graded.gates,
          reasons: graded.gates.filter((g) => g.passed).map((g) => g.reason),
          qualified: c.qualified,
          fingerprint: c.fingerprint,
          // Journal-only, always. A replayed bar can never alert or arm.
          shadow_mode: true,
          candle_time_utc: c.barTime,
          evaluated_at_utc: c.barTime,
          trading_day_utc: c.barTime.slice(0, 10),
        });
      }
    }

    if (rows.length > 0) candidatesWritten += await writeCandidates(admin, rows, rulebook);
    // Next instrument starts at the beginning of the window.
    afterBarTime = null;
  }

  return {
    ran: true,
    barsJudged,
    candidatesWritten,
    windowStart,
    cursor: {
      instrument: instruments.at(-1)?.symbol ?? null,
      afterBarTime: null,
      windowStart,
      days: settings.days,
      completedAt: new Date().toISOString(),
    },
    complete: true,
    durationMs: Date.now() - startedAt,
  };
}

async function writeCandidates(
  admin: Admin,
  rows: Array<Record<string, unknown>>,
  rulebook: Rulebook,
): Promise<number> {
  const { rulebookChecksum } = await import("./rulebook.server");
  const checksum = await rulebookChecksum(rulebook).catch(() => null);
  const payload = rows.map((r) => ({
    ...r,
    rulebook_version: rulebook.version ?? null,
    rulebook_checksum: checksum,
  }));
  const { error } = await admin.from("signal_candidates").insert(payload as never);
  if (error) {
    console.error("backfill candidate insert failed", error.message);
    return 0;
  }
  return payload.length;
}

/** Persists the cursor so the next slice resumes where this one stopped. */
export async function saveBackfillCursor(admin: Admin, cursor: BackfillCursor): Promise<void> {
  const { error } = await admin
    .from("scanner_settings")
    .update({ backfill_cursor: cursor } as never)
    .eq("id", true);
  if (error) console.error("backfill cursor save failed", error.message);
}
