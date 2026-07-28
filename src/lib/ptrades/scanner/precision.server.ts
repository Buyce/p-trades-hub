/**
 * Precision execution loop — the only place a signal becomes actionable.
 *
 * The minute-long scan tick arms setups; this loop then polls the armed watches
 * every few seconds inside the same invocation, because an execution moment
 * measured in seconds cannot be found by a once-a-minute scan.
 *
 * Each pass re-proves the whole case on closed M1 candles and the live quote:
 * price near the preferred entry, the micro trigger complete, the micro level
 * retested and held, structural invalidation present, at least the required R
 * still available at TP1, and the spread, news, expiry, freshness, duplicate
 * and daily-limit gates all passing. Anything short of that leaves the setup
 * armed. Nothing here is ever inferred: a missing input fails closed.
 */

import type { GateResult, Rulebook } from "./types";
import { DEFAULT_RULEBOOK, TIMEFRAME_LABEL, precisionRulesFor } from "./types";
import { marketData } from "./market-data.server";
import { atr } from "./atr.server";
import { dataAgeSeconds, normaliseCandles } from "./candles.server";
import { detectMicroTrigger } from "./micro-trigger.server";
import { microEntryAnchor } from "./entry-anchor.server";
import { buildExecutionZone, calculateAdaptiveZoneWidthPoints } from "./entry-zone.server";
import { isInvalidated } from "./invalidation.server";
import { armedExpiry, isExpired, transition } from "./lifecycle.server";
import { pointSizeFor, priceDistanceToPoints } from "./pips.server";
import {
  calculateExtensionR,
  distanceToEntryPoints,
  isPriceNearEntry,
  targetAlreadyTouched,
} from "./proximity.server";
import { rewardToRisk } from "./risk.server";
import { currenciesFor, macroContextFor, type MacroEvent } from "./macro.server";
import { sessionAt } from "./sessions.server";
import { resolveSymbol, roundToDigits, type InstrumentRow } from "./symbols.server";
import {
  extensionGate,
  failedGates,
  invalidationGate,
  microRetest,
  microTrigger,
  nearEntry,
  newsLockout,
  rrGate,
  sessionGate,
  spreadGate,
  staleData,
  targetTouched,
} from "./gates.server";
import {
  closeSignalLifecycle,
  listOpenWatches,
  markSignalEntryReady,
  resolveWatch,
  updateWatch,
  type PrecisionWatchRow,
} from "./persist.server";
import { notifyQualifiedSignal } from "./notify.server";
import { recordScannerError } from "./errors.server";
import { executionPrice } from "./market-data.server";
import { minTierRr, scoreCandidate, tierFor } from "./scoring";
import { isActionable, systemModeFor } from "../tiers-policy";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const MICRO_TF = "M1" as const;

export type PrecisionSummary = {
  passes: number;
  watched: number;
  entryReady: number;
  resolved: number;
};

export type PrecisionLoopOptions = {
  /** How long the loop may run inside one invocation. */
  budgetMs?: number;
  /** Gap between passes. */
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls the armed watches until the time budget is spent. Returns as soon as
 * there is nothing left to watch, so an idle minute costs no broker calls.
 */
export async function runPrecisionLoop(
  admin: Admin,
  rulebook: Rulebook = DEFAULT_RULEBOOK,
  options: PrecisionLoopOptions = {},
): Promise<PrecisionSummary> {
  const budgetMs = options.budgetMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 5_000;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + budgetMs;

  const summary: PrecisionSummary = { passes: 0, watched: 0, entryReady: 0, resolved: 0 };
  if (rulebook.precision?.enabled === false) return summary;

  const instruments = await loadInstruments(admin);
  const macroEvents = await loadMacroEvents(admin);

  while (now() < deadline) {
    const watches = await listOpenWatches(admin);
    if (watches.length === 0) break;

    summary.passes += 1;
    summary.watched = Math.max(summary.watched, watches.length);

    for (const watch of watches) {
      try {
        const outcome = await evaluateWatch(admin, watch, rulebook, instruments, macroEvents);
        if (outcome === "ENTRY_READY") summary.entryReady += 1;
        if (outcome === "RESOLVED") summary.resolved += 1;
      } catch (error) {
        await recordScannerError(admin, {
          runId: null,
          instrument: watch.symbol,
          stage: "PRECISION",
          error,
          detail: { watch_id: watch.id, state: watch.state },
        });
      }
    }

    if (now() + intervalMs >= deadline) break;
    await sleep(intervalMs);
  }

  return summary;
}

type WatchOutcome = "WAITING" | "ENTRY_READY" | "RESOLVED";

async function evaluateWatch(
  admin: Admin,
  watch: PrecisionWatchRow,
  rulebook: Rulebook,
  instruments: Map<string, InstrumentRow>,
  macroEvents: MacroEvent[],
): Promise<WatchOutcome> {
  const nowMs = Date.now();
  const direction = watch.direction === "SHORT" ? "SHORT" : "LONG";

  // Expiry is checked before anything is fetched: a dead watch costs nothing.
  if (isExpired(watch.expires_at, nowMs)) {
    await resolveWatch(admin, watch.id, "EXPIRED", "The armed setup expired before an entry formed.");
    await closeSignalLifecycle(admin, watch.signal_id, "EXPIRED");
    return "RESOLVED";
  }

  const instrument = instruments.get(watch.symbol);
  if (!instrument) {
    await resolveWatch(admin, watch.id, "MISSED", "The instrument is no longer enabled.");
    await closeSignalLifecycle(admin, watch.signal_id, "MISSED");
    return "RESOLVED";
  }

  const resolved = await resolveSymbol(instrument);
  const brokerSymbol = watch.broker_symbol ?? resolved.broker;
  const point = pointSizeFor(instrument.point_size ?? null, resolved.digits) ?? 0;
  const rules = precisionRulesFor(rulebook, watch.symbol);

  const raw = await marketData().getCandles(brokerSymbol, MICRO_TF, 120);
  const { candles: m1 } = normaliseCandles(raw, MICRO_TF);
  const lastClosedCandle = m1.at(-1) ?? null;

  const gates: GateResult[] = [];

  // 1. Still valid? A close beyond the invalidation retires the setup for good.
  if (isInvalidated(direction, watch.invalidation_price, lastClosedCandle?.close ?? null)) {
    await resolveWatch(
      admin,
      watch.id,
      "INVALIDATED",
      `Price accepted beyond ${watch.invalidation_price}.`,
    );
    await closeSignalLifecycle(admin, watch.signal_id, "INVALIDATED");
    return "RESOLVED";
  }

  const targets = Array.isArray(watch.targets) ? (watch.targets as number[]) : [];
  const tp1 = targets[0] ?? null;
  const extremeSinceArmed =
    direction === "LONG"
      ? m1.reduce<number | null>((m, c) => (m === null || c.high > m ? c.high : m), null)
      : m1.reduce<number | null>((m, c) => (m === null || c.low < m ? c.low : m), null);

  // 2. Has the move already happened without us? That is a miss, not an alert.
  if (targetAlreadyTouched(direction, tp1, extremeSinceArmed)) {
    await resolveWatch(admin, watch.id, "MISSED", "TP1 was reached before an entry formed.");
    await closeSignalLifecycle(admin, watch.signal_id, "MISSED");
    return "RESOLVED";
  }

  // Live two-sided price: the reward is proved at the price a manual trade
  // would actually pay, not at the mid or the last close.
  const liveQuote = await marketData().getQuote(brokerSymbol).catch(() => null);
  const quote =
    liveQuote !== null
      ? liveQuote.ask - liveQuote.bid
      : await marketData().getSpread(brokerSymbol).catch(() => null);
  const price =
    liveQuote !== null ? executionPrice(liveQuote, direction) : (lastClosedCandle?.close ?? null);
  const atrM1 = atr(m1, rulebook.atr_period, rulebook.atr_method);
  const atrM5 = 0; // the M5 reading is fixed at arming time; M1 governs here.

  // 3. Context gates: session, news, freshness, spread.
  const session = sessionAt(new Date(nowMs));
  gates.push(sessionGate(session, rulebook.allowed_sessions));
  const macro = macroContextFor(
    macroEvents,
    watch.symbol,
    currenciesFor(watch.symbol, instrument.base_currency, instrument.quote_currency),
    nowMs,
    rulebook.macro_lookahead_minutes,
  );
  gates.push(newsLockout(macro.locked, macro.events.map((e) => e.title)));
  gates.push(
    staleData(
      dataAgeSeconds(m1, MICRO_TF),
      instrument.max_data_age_seconds ?? rulebook.max_data_age_seconds,
    ),
  );
  gates.push(spreadGate(quote, atrM1, rulebook.max_spread_atr_ratio, instrument.max_spread ?? null));
  gates.push(invalidationGate(watch.invalidation_price !== null, watch.invalidation_condition));

  // 4. The micro trigger: rejection, displacement, break of structure, retest.
  const trigger = detectMicroTrigger({
    candles: m1,
    direction,
    zoneLow: watch.entry_zone_low ?? watch.preferred_entry ?? 0,
    zoneHigh: watch.entry_zone_high ?? watch.preferred_entry ?? 0,
    atrM1,
    displacementMinAtr: Math.min(1, rulebook.displacement_min_atr),
    retestWithinBars: rulebook.precision?.trigger_expiry_bars ?? 3,
  });
  gates.push(microTrigger(trigger.triggered, trigger.failures));
  gates.push(microRetest(trigger.confirmed, trigger.brokenLevel));

  // 5. Re-price the plan from the micro level once the trigger exists.
  const anchor = microEntryAnchor(trigger.brokenLevel, trigger.bosCandleTime, {
    anchor: watch.preferred_entry,
    source: (watch.anchor_source as never) ?? null,
    sourceCandleTime: null,
  });
  const zoneWidthPoints = calculateAdaptiveZoneWidthPoints({
    spreadPoints: quote !== null && point > 0 ? priceDistanceToPoints(quote, point) : 0,
    atrM1: atrM1 ?? 0,
    atrM5,
    point,
    minimumWidthPoints: rules.min,
    maximumWidthPoints: rules.max,
    spreadMultiplier: rules.spreadMult,
    atrM1Multiplier: rules.atrM1,
    atrM5Multiplier: rules.atrM5,
  });
  const preferredEntry = roundToDigits(anchor.anchor, resolved.digits);
  const zone =
    preferredEntry !== null
      ? buildExecutionZone({ preferredEntry, direction, zoneWidthPoints, point })
      : null;

  // 6. Execution timing: close enough to the entry, and not already extended.
  const distancePoints =
    price !== null && preferredEntry !== null
      ? distanceToEntryPoints(price, preferredEntry, point)
      : null;
  gates.push(
    nearEntry(
      price !== null &&
        preferredEntry !== null &&
        isPriceNearEntry(price, preferredEntry, point, rules.proximityPoints),
      distancePoints,
      rules.proximityPoints,
    ),
  );
  gates.push(
    extensionGate(
      price !== null && preferredEntry !== null && watch.stop_loss !== null
        ? calculateExtensionR(direction, preferredEntry, price, watch.stop_loss)
        : Number.POSITIVE_INFINITY,
      rules.maxExtensionR,
    ),
  );
  gates.push(targetTouched(false, tp1));

  // 7. The reward must still be there at the price we would actually pay.
  const rr =
    preferredEntry !== null && watch.stop_loss !== null && tp1 !== null
      ? rewardToRisk(preferredEntry, watch.stop_loss, tp1)
      : null;
  // The hard floor is the lowest tier's reward-to-risk. The tier that is
  // actually earned is resolved below, and each tier keeps its own floor.
  const minRr = Math.min(
    rulebook.precision?.min_entry_ready_rr ?? rulebook.min_rr_tp1,
    minTierRr(rulebook),
  );
  gates.push(rrGate(rr, minRr));

  const failed = failedGates(gates);
  const checkedAt = new Date(nowMs).toISOString();

  if (failed.length > 0) {
    // Not yet. Record where the setup got to; a trigger without its retest
    // stays MICRO_TRIGGERED so the next pass resumes from the same place.
    const nextState = trigger.triggered ? "MICRO_TRIGGERED" : "ARMED";
    await updateWatch(admin, watch.id, {
      state: transition(watch.state as never, nextState),
      last_checked_at: checkedAt,
      check_count: watch.check_count + 1,
      preferred_entry: preferredEntry,
      entry_zone_low: zone ? roundToDigits(zone.entryLow, resolved.digits) : watch.entry_zone_low,
      entry_zone_high: zone
        ? roundToDigits(zone.entryHigh, resolved.digits)
        : watch.entry_zone_high,
      zone_width_points: zoneWidthPoints,
      trigger_summary: trigger.summary,
      trigger_timeframe: TIMEFRAME_LABEL[MICRO_TF],
      trigger_candle_time: trigger.bosCandleTime,
      trigger_level: trigger.brokenLevel,
      metadata: {
        ...(watch.metadata as Record<string, unknown>),
        blocking: failed.map((g) => ({ code: g.code, reason: g.reason })),
        // Numeric snapshot of the pass. Without these an armed setup can die
        // with no record of how close it actually came.
        last_check: {
          at: checkedAt,
          price,
          preferred_entry: preferredEntry,
          distance_points: distancePoints,
          proximity_points: rules.proximityPoints,
          extension_r:
            price !== null && preferredEntry !== null && watch.stop_loss !== null
              ? calculateExtensionR(direction, preferredEntry, price, watch.stop_loss)
              : null,
          max_extension_r: rules.maxExtensionR,
          rr_tp1: rr,
          min_rr: minRr,
          micro_triggered: trigger.triggered,
          micro_confirmed: trigger.confirmed,
          trigger_failures: trigger.failures,
        },
      } as never,

    });
    return "WAITING";
  }

  // 8. Every gate passed. Re-score the setup on execution reality and resolve
  //    the tier it actually earns. There is no daily cap: nothing is counted,
  //    claimed or rationed here. A+, A, B and C are all allowed to alert.
  const meta = (watch.metadata ?? {}) as Record<string, unknown>;
  const scoreInput = (meta.score_input ?? {}) as Record<string, unknown>;
  const finalScore = scoreCandidate(
    {
      rr,
      biasAligned: scoreInput.bias_aligned === true,
      d1Aligned: scoreInput.d1_aligned === true,
      displacementAtr:
        typeof scoreInput.displacement_atr === "number" ? scoreInput.displacement_atr : null,
      sweepFound: scoreInput.sweep_found === true,
      retestFound: trigger.confirmed,
      spreadRatio: quote !== null && atrM1 ? quote / atrM1 : null,
      lateDistanceAtr:
        price !== null && preferredEntry !== null && atrM1
          ? Math.abs(price - preferredEntry) / atrM1
          : null,
      macroAligned: scoreInput.macro_aligned === true,
    },
    rulebook,
  );
  const finalTier = tierFor(finalScore.score, rr, rulebook);

  if (finalTier === null) {
    // The setup no longer earns any tier at execution prices. Stay armed; the
    // next pass may find a better price. Never alert an unresolved tier.
    await updateWatch(admin, watch.id, {
      last_checked_at: checkedAt,
      check_count: watch.check_count + 1,
      metadata: {
        ...meta,
        blocking: [
          {
            code: "TIER_NOT_MET",
            reason: `Score ${finalScore.score} with ${rr === null ? "unknown" : rr.toFixed(2)}R meets no tier's requirements.`,
          },
        ],
      } as never,
    });
    return "WAITING";
  }

  const reasons = [
    ...trigger.reasons,
    ...gates.filter((g) => g.passed).map((g) => g.reason),
  ];
  const expiresAtUtc = armedExpiry(new Date(nowMs), rulebook.signal_expiry_minutes);

  // Idempotent: only the first pass to flip the signal actionable notifies.
  const promoted = await markSignalEntryReady(admin, watch.signal_id, {
    preferredEntry,
    entryLow: zone ? roundToDigits(zone.entryLow, resolved.digits) : null,
    entryHigh: zone ? roundToDigits(zone.entryHigh, resolved.digits) : null,
    zoneWidthPoints,
    triggerSummary: trigger.summary,
    triggerTimeframe: TIMEFRAME_LABEL[MICRO_TF],
    triggerCandleTime: trigger.retestCandleTime ?? trigger.bosCandleTime,
    triggerLevel: trigger.brokenLevel,
    priceAtAlert: price,
    distanceToEntryPoints: distancePoints,
    rr: rr === null ? null : Number(rr.toFixed(3)),
    spread: quote,
    reasons,
    expiresAtUtc,
    provisionalScore: typeof meta.score === "number" ? meta.score : null,
    provisionalGrade: typeof meta.grade === "string" ? meta.grade : null,
    finalScore: finalScore.score,
    finalGrade: finalTier,
    finalScoreComponents: finalScore.components,
  });

  await updateWatch(admin, watch.id, {
    state: "ENTRY_READY",
    entry_ready_at: checkedAt,
    resolved_at: checkedAt,
    last_checked_at: checkedAt,
    check_count: watch.check_count + 1,
    preferred_entry: preferredEntry,
    entry_zone_low: zone ? roundToDigits(zone.entryLow, resolved.digits) : null,
    entry_zone_high: zone ? roundToDigits(zone.entryHigh, resolved.digits) : null,
    zone_width_points: zoneWidthPoints,
    trigger_summary: trigger.summary,
    trigger_timeframe: TIMEFRAME_LABEL[MICRO_TF],
    trigger_candle_time: trigger.retestCandleTime,
    trigger_level: trigger.brokenLevel,
    metadata: {
      ...meta,
      blocking: [],
      final_grade: finalTier,
      final_score: finalScore.score,
    } as never,
  });

  if (!promoted) return "WAITING";

  // The one actionable test in the system. Fails closed on shadow mode, a
  // pre-ENTRY_READY state, an unknown tier or any outstanding gate.
  const actionable = isActionable({
    grade: finalTier,
    lifecycleState: "ENTRY_READY",
    hardGateFailures: [],
    systemMode: systemModeFor(shadowMode),
    notificationAlreadySent: false,
  });
  if (!actionable) return "ENTRY_READY";

  await notifyQualifiedSignal(admin, {
    shadowMode,
    signalId: watch.signal_id,
    instrument: watch.symbol,
    direction,
    grade: finalTier,
    setupType: (meta.setup_type as string) ?? null,
    timeframe: TIMEFRAME_LABEL[MICRO_TF],
    entryZoneLow: zone ? roundToDigits(zone.entryLow, resolved.digits) : null,
    entryZoneHigh: zone ? roundToDigits(zone.entryHigh, resolved.digits) : null,
    stopLoss: watch.stop_loss,
    targets,
    rr: rr === null ? null : Number(rr.toFixed(3)),
    score: finalScore.score,
    reasons,
  });

  return "ENTRY_READY";
}

async function loadInstruments(admin: Admin): Promise<Map<string, InstrumentRow>> {
  const { data } = await admin
    .from("instruments")
    .select(
      "symbol, broker_symbol, aliases, digits, point_size, contract_size, base_currency, quote_currency, sessions, min_rr, max_spread, max_data_age_seconds",
    )
    .eq("enabled", true);
  return new Map(((data ?? []) as InstrumentRow[]).map((row) => [row.symbol, row]));
}

async function loadMacroEvents(admin: Admin): Promise<MacroEvent[]> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("macro_events")
    .select("*")
    .gte("event_time_utc", since)
    .order("event_time_utc");
  return (data ?? []) as unknown as MacroEvent[];
}
