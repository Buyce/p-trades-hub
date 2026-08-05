import type { Bias, Candidate, Candle, GateCode, GateResult, Rulebook, Timeframe } from "./types";
import {
  DEFAULT_RULEBOOK,
  TIMEFRAME_LABEL,
  TIMEFRAME_SECONDS,
  armingDisplacementFor,
  candleGapMultipleFor,
  precisionRulesFor,
} from "./types";

import { dataAgeSeconds, lastClosed, normaliseCandles, type CandleReject } from "./candles.server";
import { isStoreFresh, readSeries } from "./market-candles.server";
import { evaluateBiasPolicy, biasPolicyGate, type BiasDecision } from "./bias-policy.server";
import { structuralIdeaId } from "./structural-idea";
import { validateRulebook } from "./rulebook-validate";

import { recordScannerError } from "./errors.server";
import { AppError } from "../errors";
import { atr } from "./atr.server";
import { higherTimeframeBias } from "./bias.server";
import { checkLateEntry } from "./late-entry.server";
import { rulebookChecksum } from "./rulebook.server";
import { minTierRr, scoreCandidate } from "./scoring.server";
import { rewardToRisk, structuralTargets } from "./risk.server";
import { swingHighs, swingLows } from "./swings.server";
import { detectSetupDetailed, type SetupResult } from "./setups.server";
import { checkCandleSanity } from "./sanity.server";
import { sessionAt } from "./sessions.server";
import { currenciesFor, macroContextFor, type MacroEvent } from "./macro.server";
import { roundToDigits, type InstrumentRow } from "./symbols.server";
import { entryAnchorForSetup } from "./entry-anchor.server";
import {
  buildArmingZone,
  buildExecutionZone,
  calculateAdaptiveZoneWidthPoints,
} from "./entry-zone.server";
import { buildInvalidation, hasInvalidation } from "./invalidation.server";
import { pointSizeFor, priceDistanceToPoints } from "./pips.server";
import {
  SCAN_LOCK_KEY,
  acquireScanLock,
  createDeadline,
  newLockHolder,
  releaseScanLock,
} from "./lock.server";
import { armedExpiry } from "./lifecycle.server";
import {
  candleSanity,
  duplicate,
  gate,
  invalidStop,
  invalidationGate,
  missingData,
  newsLockout,
  noSetup,
  sessionGate,
  staleData,
} from "./gates.server";

import {
  closeStaleRuns,
  cacheCandle,
  fingerprintExistsToday,
  finishRun,
  openPrecisionWatch,
  promoteToSignal,
  saveCandidate,
  saveRejections,
  startRun,
  tradingDayUtc,
} from "./persist.server";
import { safeHeartbeat } from "./heartbeat.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const ENTRY_TF: Timeframe = "M15";
const REQUIRED: Timeframe[] = ["M5", "M15", "1h", "4h", "1d"];

const EXECUTION_ONLY_GATES = new Set<GateCode>([
  "SPREAD",
  "RR_BELOW_MIN",
  "LATE_ENTRY",
  "EXPIRED",
  "NO_MICRO_TRIGGER",
  "NO_MICRO_RETEST",
  "NOT_NEAR_ENTRY",
  "TARGET_TOUCHED",
  "TIER_NOT_MET",
]);

const DATA_AVAILABILITY_GATES = new Set<GateCode>(["MISSING_DATA", "STALE_DATA"]);

export function armingFailedGates(gates: GateResult[]): GateResult[] {
  return gates.filter((g) => !g.passed && !EXECUTION_ONLY_GATES.has(g.code));
}

/**
 * Arming boundary. A watch may open on a lower displacement than final quality
 * requires: the measured value is preserved and re-judged at ENTRY_READY.
 */
export function isArmableSetup(
  setup: SetupResult,
  rulebook: Rulebook,
  symbol?: string | null,
): boolean {
  const threshold = armingDisplacementFor(rulebook, symbol);
  const displacementOk = setup.displacementAtr !== null && setup.displacementAtr >= threshold;
  const hasStructure = setup.sweepFound || setup.structureType !== null;
  return Boolean(setup.direction && setup.level !== null && hasStructure && displacementOk);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([
    promise.finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }),
    timeout,
  ]);
}

export type ScanSummary = {
  ok: boolean;
  shadowMode: boolean;
  scanned: string[];
  candidates: number;
  qualified: number;
  actionable: number;
  /** Setups armed this run and handed to the precision loop. */
  armed?: number;
  rejections: number;
  message?: string;
};

/** The active rulebook, for callers outside the scan (the precision loop). */
export async function loadActiveRulebook(admin: Admin): Promise<Rulebook> {
  const { data } = await admin
    .from("rulebook_versions")
    .select("version, rules, status")
    .eq("is_active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || data.status !== "ACTIVE") {
    throw new Error("No governed ACTIVE rulebook is selected.");
  }
  return parseRulebook(data);
}

/**
 * Deep-merges and VALIDATES the stored rulebook. A shallow spread used to let a
 * partial override delete every sibling key it did not mention, and nothing
 * checked that the resulting grade bands were reachable. An invalid rulebook is
 * now rejected outright in favour of the known-good defaults.
 */
export function parseRulebook(row: { version: string; rules: unknown } | null): Rulebook {
  if (!row) return DEFAULT_RULEBOOK;
  const result = validateRulebook(row.rules ?? {}, row.version);
  if (!result.valid) {
    console.error(
      `rulebook ${row.version} rejected, falling back to defaults:`,
      result.issues.map((i) => `${i.path}: ${i.message}`).join("; "),
    );
  }
  return result.rulebook;
}

/** The validation report, for governance telemetry. */
export function inspectRulebook(row: { version: string; rules: unknown } | null) {
  return validateRulebook(row?.rules ?? {}, row?.version ?? DEFAULT_RULEBOOK.version);
}

async function loadMacroEvents(admin: Admin): Promise<MacroEvent[]> {
  const now = Date.now();
  const from = new Date(now - 6 * 3600_000).toISOString();
  const to = new Date(now + 6 * 3600_000).toISOString();
  const { data } = await admin
    .from("macro_events")
    .select("title, currency, impact, event_time_utc, lockout_start_utc, lockout_end_utc, symbols")
    .gte("event_time_utc", from)
    .lte("event_time_utc", to);
  return (data ?? []) as MacroEvent[];
}

/**
 * Target ladder for a candidate. Structure first — the next opposing liquidity
 * levels ahead of the entry — with the fixed R-multiple ladder only as a
 * fallback when structure runs out.
 */
function scanTargets(
  entry: number,
  stop: number,
  direction: "LONG" | "SHORT",
  levels: number[],
  atr: number | null,
  minRr: number,
): number[] {
  return structuralTargets({
    entry,
    stop,
    direction,
    levels,
    atr,
    minRr,
    fallbackMultiples: [2, 3, 4],
  }).map((v) => Number(v.toFixed(6)));
}

type FetchedCandles = {
  candles: Record<Timeframe, Candle[]>;
  rejects: Array<{ timeframe: Timeframe; rejects: CandleReject[] }>;
  /** Timeframes the store could not serve and that had to be fetched live. */
  degraded: Array<{ timeframe: Timeframe; message: string; firstMessage: string }>;
  /** Where each timeframe came from — proof the data plane is working. */
  sources: Record<string, "STORE" | "LIVE" | "MISSING">;
  /** Age in seconds of each served series, measured from its close. */
  ages: Record<string, number | null>;
};

/**
 * Single source of truth for how long a run may hold the scan lock. Stale-run
 * cleanup uses the same value, so a run can never be declared dead while it
 * still legitimately owns the lock.
 */
export const SCAN_LOCK_TTL_SECONDS = 55;

/**
 * Hard runtime budget for a whole context scan. The run stops cleanly at the
 * budget and reports PARTIAL rather than being killed mid-write, which is what
 * used to leave the lock behind and skip every subsequent tick. At a
 * one-minute cadence a run that overruns must yield the next tick quickly, so
 * the budget sits inside two ticks rather than two minutes.
 */
export const SCAN_BUDGET_MS = 50_000;

/**
 * The context scan READS the durable candle store; it does not download
 * history. The `sync-market-data` pass owns downloads.
 *
 * Missing or stale history fails closed. The sync pass is the only component
 * allowed to download candles, preventing context and precision from competing
 * for the provider's single market-data resource slot.
 */
async function fetchTimeframes(
  admin: Admin,
  instrument: string,
  symbol: string,
  feedBudgetSeconds: number,
  minBars: number,
): Promise<FetchedCandles> {
  const rejects: FetchedCandles["rejects"] = [];
  const degraded: FetchedCandles["degraded"] = [];
  const sources: FetchedCandles["sources"] = {};
  const ages: FetchedCandles["ages"] = {};
  const entries: Array<readonly [Timeframe, Candle[]]> = [];

  const stored = await readSeries(admin, {
    brokerSymbol: symbol,
    timeframes: REQUIRED,
    limit: 200,
  });

  for (const tf of REQUIRED) {
    const series = stored[tf] ?? { candles: [], ageSeconds: null };
    const label = TIMEFRAME_LABEL[tf];
    const usable =
      series.candles.length >= minBars && isStoreFresh(series.ageSeconds, tf, feedBudgetSeconds);

    if (usable) {
      sources[label] = "STORE";
      ages[label] = series.ageSeconds;
      entries.push([tf, series.candles] as const);
      continue;
    }

    sources[label] = series.candles.length > 0 ? "STORE" : "MISSING";
    ages[label] = series.ageSeconds;
    degraded.push({
      timeframe: tf,
      message: series.candles.length === 0 ? "no stored series" : "stored series too old",
      firstMessage: `store age ${series.ageSeconds ?? "n/a"}s, bars ${series.candles.length}`,
    });
    entries.push([tf, series.candles] as const);
  }

  return {
    candles: Object.fromEntries(entries) as Record<Timeframe, Candle[]>,
    rejects,
    degraded,
    sources,
    ages,
  };
}

type Evaluation = {
  candidate: Candidate | null;
  gates: GateResult[];
  macroContext: Record<string, unknown>;
  /** Everything the precision loop needs to arm and watch this setup. */
  precision?: {
    brokerSymbol: string;
    preferredEntry: number | null;
    zoneWidthPoints: number;
    anchorSource: string | null;
    structuralLevel: number | null;
    armingZoneLow: number | null;
    armingZoneHigh: number | null;
    invalidation: { price: number | null; condition: string | null; timeframe: string | null };
    armedExpiryMinutes: number;
    /** Structural score inputs, fixed at arming and re-used at ENTRY_READY. */
    scoreInput: {
      bias_aligned: boolean;
      d1_aligned: boolean;
      displacement_atr: number | null;
      sweep_found: boolean;
      setup_type: SetupResult["setupType"];
      structure_type: SetupResult["structureType"];
      macro_aligned: boolean;
    };
  };
};

/** Evaluates a single instrument and returns its candidate plus every gate result. */
async function evaluateInstrument(
  admin: Admin,
  instrument: InstrumentRow,
  rulebook: Rulebook,
  macroEvents: MacroEvent[],
  runId: string | null,
): Promise<Evaluation> {
  const gates: GateResult[] = [];
  const now = new Date();

  // Session gate first: outside its allowed sessions an instrument is not
  // scanned for entries at all.
  const session = sessionAt(now);
  const allowedSessions =
    instrument.sessions && instrument.sessions.length > 0
      ? instrument.sessions
      : rulebook.allowed_sessions;
  gates.push(sessionGate(session, allowedSessions));

  // Context is provider-independent. The sync pass is solely responsible for
  // validating and populating this configured broker symbol.
  const symbol = instrument.broker_symbol;
  if (!symbol) {
    await recordScannerError(admin, {
      runId,
      instrument: instrument.symbol,
      stage: "SYMBOL_RESOLUTION",
      error: new AppError("CONFIG", "No broker_symbol is configured for this instrument."),
    });
    gates.push(missingData(false, { error: "Missing configured broker_symbol" }));
    return { candidate: null, gates, macroContext: {} };
  }

  const feedBudget = instrument.max_data_age_seconds ?? rulebook.max_data_age_seconds;
  const minBars = rulebook.atr_period + 2;

  let candles: Record<Timeframe, Candle[]>;
  let dataSources: Record<string, string> = {};
  let dataAges: Record<string, number | null> = {};
  try {
    const fetched = await fetchTimeframes(admin, instrument.symbol, symbol, feedBudget, minBars);
    candles = fetched.candles;
    dataSources = fetched.sources;
    dataAges = fetched.ages;
    if (fetched.degraded.length > 0) {
      await recordScannerError(admin, {
        runId,
        instrument: instrument.symbol,
        stage: "MARKET_DATA",
        error: new AppError(
          "UPSTREAM",
          "Required candle series could not be served from the durable store",
        ),
        detail: {
          broker_symbol: symbol,
          degraded: fetched.degraded.map((entry) => ({
            timeframe: TIMEFRAME_LABEL[entry.timeframe],
            store_state: entry.firstMessage,
            result: entry.message,
          })),
        },
      });
    }
    for (const entry of fetched.rejects) {
      await recordScannerError(admin, {
        runId,
        instrument: instrument.symbol,
        stage: "NORMALISATION",
        error: new AppError(
          "VALIDATION",
          `${entry.rejects.length} malformed candle(s) dropped on ${TIMEFRAME_LABEL[entry.timeframe]}`,
        ),
        detail: { broker_symbol: symbol, rejects: entry.rejects.slice(0, 20) },
      });
    }
  } catch (error) {
    await recordScannerError(admin, {
      runId,
      instrument: instrument.symbol,
      stage: "MARKET_DATA",
      error,
      detail: { broker_symbol: symbol },
    });
    gates.push(
      missingData(false, {
        error: error instanceof Error ? error.message : "fetch failed",
        broker_symbol: symbol,
      }),
    );
    return { candidate: null, gates, macroContext: {} };
  }

  const haveAll = REQUIRED.every((tf) => candles[tf].length >= minBars);
  gates.push(
    missingData(haveAll, {
      broker_symbol: symbol,
      resolved_from: "broker_symbol",
      data_sources: dataSources,
      store_age_seconds: dataAges,
      ...Object.fromEntries(REQUIRED.map((tf) => [TIMEFRAME_LABEL[tf], candles[tf].length])),
    }),
  );

  if (!haveAll) return { candidate: null, gates, macroContext: {} };

  const entryCandles = candles[ENTRY_TF];
  const last = lastClosed(entryCandles)!;
  await cacheCandle(admin, instrument.symbol, TIMEFRAME_LABEL[ENTRY_TF], last);

  const sanity = checkCandleSanity(
    entryCandles,
    ENTRY_TF,
    60,
    candleGapMultipleFor(rulebook, instrument.symbol),
  );

  gates.push(candleSanity(sanity.ok, sanity.problems));

  // The freshness budget is measured from the close of the last closed entry
  // candle, which by definition ages a full timeframe interval before the next
  // one closes. Without that allowance a 300s budget on M15 rejects two thirds
  // of all minute-by-minute scans as STALE_DATA even on a perfectly live feed.
  const maxAge = feedBudget + TIMEFRAME_SECONDS[ENTRY_TF];

  gates.push(staleData(dataAgeSeconds(entryCandles, ENTRY_TF), maxAge));

  // Macro lockout scoped to the currencies this instrument actually trades.
  const currencies = currenciesFor(
    instrument.symbol,
    instrument.base_currency,
    instrument.quote_currency,
  );
  const macro = macroContextFor(
    macroEvents,
    instrument.symbol,
    currencies,
    now.getTime(),
    rulebook.macro_lookahead_minutes,
  );
  gates.push(
    newsLockout(
      macro.locked,
      macro.events.map((e) => e.title),
    ),
  );

  const atrValue = atr(entryCandles, rulebook.atr_period, rulebook.atr_method);
  const { bias, d1 } = higherTimeframeBias(candles["4h"], candles["1d"], rulebook.swing_lookback);

  const armingThreshold = armingDisplacementFor(rulebook, instrument.symbol);
  const detection = detectSetupDetailed(
    {
      candles: entryCandles,
      atr: atrValue,
      bias: bias as Bias,
      swingLookback: rulebook.swing_lookback,
      displacementMinAtr: rulebook.displacement_min_atr,
    },
    // Armability is evaluated for EVERY family before one is selected, so a
    // non-armable sweep partial can never mask an armable break/retest.
    {
      isArmable: (candidate) => isArmableSetup(candidate, rulebook, instrument.symbol),
      isBiasEligible: (candidate) =>
        evaluateBiasPolicy({
          setup: candidate,
          direction: candidate.direction,
          bias: bias as Bias,
          d1: d1 as Bias,
          rulebook,
        }).passed,
    },
  );
  const setup: SetupResult = detection.selected ?? {
    found: false,
    setupType: "SWEEP_DISPLACEMENT_RETEST" as const,
    direction: null,
    level: null,
    extreme: null,
    entryLow: null,
    entryHigh: null,
    sweepFound: false,
    displacementAtr: null,
    retestFound: false,
    structureType: null,
    sequence: { sweepIndex: null, breakIndex: null, displacementIndex: null, retestIndex: null },
    sequenceValid: true,
    detail: {},
  };

  // Detection telemetry. Without it a "no setup" rejection says only that
  // nothing formed; with it we can see which stage of which family stopped,
  // and whether the inputs themselves were degraded. Reporting only.
  const armableSetup = isArmableSetup(setup, rulebook, instrument.symbol);
  const familyTelemetry = detection.diagnosticResults.map((r) => ({
    family: r.setupType,
    complete: r.found,
    armable: isArmableSetup(r, rulebook, instrument.symbol),
    direction: r.direction,
    level: r.level,
    displacement_atr: r.displacementAtr,
    sweep_found: r.sweepFound,
    retest_found: r.retestFound,
    structure_type: r.structureType,
  }));
  const detectionDetail = {
    ...setup.detail,
    stage:
      !setup.sweepFound && setup.structureType === null
        ? "NO_STRUCTURE_EVENT"
        : setup.displacementAtr === null || setup.displacementAtr < armingThreshold
          ? "NO_DISPLACEMENT"
          : !setup.retestFound
            ? "ARMED_AWAITING_M1_EXECUTION"
            : "COMPLETE",
    armable: armableSetup,
    selected_from: detection.selectedFrom,
    best_family: setup.setupType,
    families: familyTelemetry,
    complete_families: detection.completeResults.map((r) => r.setupType),
    armable_families: detection.armableResults.map((r) => r.setupType),
    direction: setup.direction,
    level: setup.level,
    extreme: setup.extreme,
    displacement_atr: setup.displacementAtr,
    arming_displacement_min_atr: armingThreshold,
    displacement_min_atr: rulebook.displacement_min_atr,
    sweep_found: setup.sweepFound,
    retest_found: setup.retestFound,
    structure_type: setup.structureType,
    bias,
    atr: atrValue,
    entry_candles: entryCandles.length,
    swing_lookback: rulebook.swing_lookback,
  };
  gates.push(noSetup(armableSetup, setup.setupType, detectionDetail));

  // No armable structure means every downstream derivation (anchor, zone, stop,
  // targets, R:R, invalidation) is arithmetic on nulls. Stop here instead: the
  // single NO_SETUP row now carries the diagnosis.
  if (!armableSetup) return { candidate: null, gates, macroContext: {} };

  const direction: "LONG" | "SHORT" = setup.direction ?? (bias === "SHORT" ? "SHORT" : "LONG");

  gates.push({
    code: "NO_SWEEP",
    passed: setup.sweepFound || setup.setupType !== "SWEEP_DISPLACEMENT_RETEST",
    reason: setup.sweepFound
      ? `Liquidity swept at ${setup.level} and reclaimed.`
      : setup.setupType === "SWEEP_DISPLACEMENT_RETEST"
        ? "No liquidity sweep of a prior swing on the entry timeframe."
        : `${setup.setupType} does not require a liquidity sweep.`,
    detail: { level: setup.level, ...setup.detail },
  });
  // Arming uses the arming threshold; the measured value is stored untouched
  // and re-judged by scoring and the execution gates at ENTRY_READY.
  gates.push({
    code: "NO_DISPLACEMENT",
    passed: setup.displacementAtr !== null && setup.displacementAtr >= armingThreshold,
    reason:
      setup.displacementAtr !== null
        ? `Displacement candle of ${setup.displacementAtr.toFixed(2)} ATR in the ${direction} direction.`
        : "No displacement candle of sufficient size.",
    detail: {
      bodyAtr: setup.displacementAtr,
      armingMinAtr: armingThreshold,
      finalMinAtr: rulebook.displacement_min_atr,
    },
  });
  // Spread is execution-time data. Context never calls the live provider;
  // Precision proves spread from its one two-sided quote before alerting.
  const spread: number | null = null;

  // Precision execution zone. The setup's own retest band is only an
  // approximation of where price traded; the tradable zone is built from the
  // anchor outwards, narrow, asymmetric and always on the favourable side.
  const precisionRules = precisionRulesFor(rulebook, instrument.symbol);
  const point = pointSizeFor(instrument.point_size ?? null, instrument.digits) ?? 0;
  const anchor = entryAnchorForSetup(setup, entryCandles);
  const atrM5 = atr(candles["M5"], rulebook.atr_period, rulebook.atr_method) ?? 0;
  const spreadPoints = point > 0 && spread !== null ? priceDistanceToPoints(spread, point) : 0;
  const zoneWidthPoints = calculateAdaptiveZoneWidthPoints({
    spreadPoints,
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

  const entryLow = roundToDigits(zone ? zone.entryLow : setup.entryLow, instrument.digits);
  const entryHigh = roundToDigits(zone ? zone.entryHigh : setup.entryHigh, instrument.digits);
  // The plan is priced at the preferred entry, never at the middle of a band.
  const entry =
    roundToDigits(zone ? zone.preferredEntry : null, instrument.digits) ??
    (entryLow !== null && entryHigh !== null ? (entryLow + entryHigh) / 2 : null);
  const armingZone =
    setup.level !== null && atrValue !== null
      ? buildArmingZone({
          direction,
          structuralLevel: setup.level,
          atr: atrValue,
          detectedLow: setup.entryLow,
          detectedHigh: setup.entryHigh,
        })
      : null;
  const armingZoneLow = roundToDigits(armingZone?.armingLow ?? null, instrument.digits);
  const armingZoneHigh = roundToDigits(armingZone?.armingHigh ?? null, instrument.digits);

  const invalidation = buildInvalidation({
    direction,
    extreme: setup.extreme,
    level: setup.level,
    timeframe: TIMEFRAME_LABEL[ENTRY_TF],
    digits: instrument.digits,
  });
  gates.push(invalidationGate(hasInvalidation(invalidation), invalidation.condition));

  const stop = roundToDigits(
    setup.extreme !== null && atrValue
      ? direction === "LONG"
        ? setup.extreme - atrValue * 0.2
        : setup.extreme + atrValue * 0.2
      : null,
    instrument.digits,
  );

  // Bias eligibility, not blind alignment: reversal families (sweep, CHOCH)
  // are allowed to trade against the H4 bias; continuations are not.
  const biasDecision: BiasDecision = evaluateBiasPolicy({
    setup,
    direction,
    bias: bias as Bias,
    d1: d1 as Bias,
    rulebook,
  });
  gates.push(biasPolicyGate(biasDecision));

  gates.push(invalidStop(entry, stop, direction, atrValue, rulebook.max_stop_atr_multiple));

  // Opposing liquidity ahead of the entry: prior swing highs for a long, prior
  // swing lows for a short. These are the destinations the setup is actually
  // trading towards, so they define the target ladder.
  const opposingLevels = (
    direction === "LONG"
      ? swingHighs(entryCandles, rulebook.swing_lookback)
      : swingLows(entryCandles, rulebook.swing_lookback)
  ).map((s) => s.price);

  const targets =
    entry !== null && stop !== null
      ? scanTargets(entry, stop, direction, opposingLevels, atrValue, minTierRr(rulebook)).map(
          (t) => roundToDigits(t, instrument.digits) as number,
        )
      : [];
  const rrRaw = targets.length > 0 ? rewardToRisk(entry, stop, targets[0]) : null;
  // Stored to two decimals so a displayed R:R always matches the stored one.
  const rr = rrRaw === null ? null : Number(rrRaw.toFixed(2));
  const late = checkLateEntry(
    last.close,
    entryLow,
    entryHigh,
    atrValue,
    rulebook.late_entry_max_atr_from_entry,
  );
  const print = structuralIdeaId({
    instrument: instrument.symbol,
    direction,
    level: setup.level,
    atr: atrValue,
    tradingDayUtc: tradingDayUtc(),
  });
  gates.push(duplicate(await fingerprintExistsToday(admin, print), print));

  const spreadRatio = spread !== null && atrValue ? spread / atrValue : null;
  const {
    score,
    grade: scoreGrade,
    components,
  } = scoreCandidate(
    {
      rr,
      setupType: setup.setupType,
      structureType: setup.structureType,
      biasAligned: biasDecision.aligned,
      d1Aligned: d1 === direction,
      displacementAtr: setup.displacementAtr,
      sweepFound: setup.sweepFound,
      retestFound: setup.retestFound,
      spreadRatio,
      lateDistanceAtr: late.distanceAtr,
      macroAligned: macro.aligned,
    },
    rulebook,
  );

  // Arming boundary: a setup is armable when every ARMING gate passes. The
  // score band is NOT an arming requirement — the tier a setup earns is
  // resolved by the precision loop at execution prices, so requiring a final
  // grade here made the lower tiers unreachable.
  const failed = armingFailedGates(gates);
  const qualified = failed.length === 0;
  // Provisional tier only. The displayed tier is recalculated at ENTRY_READY.
  const grade = scoreGrade;

  const candidate: Candidate = {
    instrument: instrument.symbol,
    broker_symbol: symbol,
    timeframe: TIMEFRAME_LABEL[ENTRY_TF],
    direction,
    setup_type: setup.setupType,
    bias: bias as Bias,
    entry_zone_low: entryLow,
    entry_zone_high: entryHigh,
    stop_loss: stop,
    targets,
    rr_tp1: rr === null ? null : Number(rr.toFixed(3)),
    atr: atrValue,
    spread,
    score,
    grade,
    score_components: components,
    gate_results: gates,
    reasons: gates.filter((g) => g.passed).map((g) => g.reason),
    qualified,
    fingerprint: print,
    candle_time_utc: last.time,
  };

  return {
    candidate,
    gates,
    precision: {
      brokerSymbol: symbol,
      preferredEntry: entry,
      zoneWidthPoints,
      anchorSource: anchor.source,
      structuralLevel: setup.level,
      armingZoneLow,
      armingZoneHigh,
      invalidation,
      armedExpiryMinutes: precisionRules.armedExpiryMinutes,
      scoreInput: {
        bias_aligned: biasDecision.aligned,
        d1_aligned: d1 === direction,
        displacement_atr: setup.displacementAtr,
        sweep_found: setup.sweepFound,
        setup_type: setup.setupType,
        structure_type: setup.structureType,
        macro_aligned: macro.aligned,
      },
    },
    macroContext: {
      session,
      currencies,
      locked: macro.locked,
      events: macro.events,
      upcoming: macro.upcoming,
    },
  };
}

/** One full scan across every enabled instrument. */
export async function runScan(admin: Admin): Promise<ScanSummary> {
  const { data: settings } = await admin
    .from("scanner_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  const shadowMode = settings?.shadow_mode ?? true;
  // Delivery test mode: a sample alert goes out the moment a setup is ARMED,
  // so the notification path can be proven without waiting for an M1 trigger.
  // It changes nothing about detection, scoring or actionability.
  const alertTestMode =
    (settings as { alert_test_mode?: boolean } | null)?.alert_test_mode === true;
  const activeRulebook = await loadActiveRulebook(admin);
  if (settings?.rulebook_version !== activeRulebook.version) {
    await safeHeartbeat(admin, {
      source: "CONTEXT_SCANNER",
      status: "ERROR",
      metaapiConnected: null,
      rulebookVersion: activeRulebook.version,
      detail: {
        reason: "Rulebook governance/setting mismatch; scan failed closed.",
        settings_version: settings?.rulebook_version ?? null,
        active_version: activeRulebook.version,
      },
    });
    return {
      ok: false,
      shadowMode,
      scanned: [],
      candidates: 0,
      qualified: 0,
      actionable: 0,
      armed: 0,
      rejections: 0,
      message: "Rulebook version mismatch",
    };
  }

  const empty = (message: string, ok = true): ScanSummary => ({
    ok,
    shadowMode,
    scanned: [],
    candidates: 0,
    qualified: 0,
    actionable: 0,
    armed: 0,
    rejections: 0,
    message,
  });

  if (settings && settings.scanning_enabled === false) {
    await safeHeartbeat(admin, {
      source: "CONTEXT_SCANNER",
      status: "IDLE",
      metaapiConnected: null,
      rulebookVersion: settings.rulebook_version ?? null,
      detail: { reason: "Scanning disabled in scanner settings." },
    });
    return empty("Scanning disabled");
  }

  // Overlap protection: a slow run must never race the next scheduled tick.
  // The holder is unique per invocation, so a slow predecessor can never
  // release the lock its successor now owns.
  const holder = newLockHolder("context");
  const locked = await acquireScanLock(admin, {
    ttlSeconds: SCAN_LOCK_TTL_SECONDS,
    holder,
  });

  if (!locked) {
    // The component is alive; it just could not take the lock this tick.
    // Report WHO holds it and for how long, otherwise a SKIPPED streak is
    // indistinguishable from a healthy idle scanner.
    const { data: lockRow } = await admin
      .from("scanner_locks")
      .select("holder, locked_at, expires_at")
      .eq("lock_key", SCAN_LOCK_KEY)
      .maybeSingle();
    const lockedAtMs = lockRow?.locked_at ? new Date(lockRow.locked_at).getTime() : null;
    await safeHeartbeat(admin, {
      source: "CONTEXT_SCANNER",
      status: "SKIPPED",
      metaapiConnected: null,
      rulebookVersion: settings?.rulebook_version ?? null,
      detail: {
        reason: "A scan was already running.",
        lock_holder: lockRow?.holder ?? null,
        lock_locked_at: lockRow?.locked_at ?? null,
        lock_expires_at: lockRow?.expires_at ?? null,
        lock_age_seconds: lockedAtMs ? Math.round((Date.now() - lockedAtMs) / 1000) : null,
      },
    });
    return empty("A scan is already running");
  }

  try {
    return await runScanLocked(admin, shadowMode, holder, alertTestMode);
  } catch (error) {
    // A thrown scan must still report liveness, otherwise a crashing scanner
    // and a stopped scanner look identical from the dashboard.
    const message = error instanceof Error ? error.message : "scan failed";
    await safeHeartbeat(admin, {
      source: "CONTEXT_SCANNER",
      status: "ERROR",
      metaapiConnected: null,
      rulebookVersion: settings?.rulebook_version ?? null,
      detail: { error: message, lock_holder: holder },
    });
    throw error;
  } finally {
    await releaseScanLock(admin, SCAN_LOCK_KEY, holder);
  }
}

async function runScanLocked(
  admin: Admin,
  shadowMode: boolean,
  holder: string,
  alertTestMode: boolean,
): Promise<ScanSummary> {
  const startedAtMs = Date.now();
  const deadline = createDeadline(SCAN_BUDGET_MS);
  const { data: rulebookRow } = await admin
    .from("rulebook_versions")
    .select("version, rules, status")
    .eq("is_active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rulebookRow || rulebookRow.status !== "ACTIVE") {
    throw new Error("Active rulebook governance changed during the scan.");
  }
  const rulebook = parseRulebook(rulebookRow);
  // Governance: every row this run writes carries the checksum of the exact
  // rules it was evaluated against.
  const checksum = await rulebookChecksum(rulebookRow?.rules ?? rulebook);

  const { data: instruments } = await admin
    .from("instruments")
    .select(
      "symbol, broker_symbol, aliases, digits, point_size, contract_size, base_currency, quote_currency, sessions, min_rr, max_spread, max_data_age_seconds",
    )
    .eq("enabled", true)
    .order("sort_order");

  // Close any run a killed worker left open before starting a new one.
  await closeStaleRuns(admin, SCAN_LOCK_TTL_SECONDS);

  const rows = (instruments ?? []) as InstrumentRow[];
  const symbols = rows.map((i) => i.symbol);
  const runId = await startRun(admin, symbols, rulebook.version, checksum);
  const macroEvents = await loadMacroEvents(admin);

  let candidates = 0;
  let qualifiedCount = 0;
  const actionable = 0;
  let armed = 0;
  let rejectionCount = 0;
  const completedSymbols: string[] = [];
  const dataUnavailableSymbols = new Set<string>();
  const dataAvailabilityFailures: Array<{
    instrument: string;
    gate: GateCode;
    reason: string;
  }> = [];
  const runRejections: Array<{ instrument: string; gate: string; reason: string }> = [];
  let errorMessage: string | null = null;
  let deadlineHit = false;

  for (const instrument of rows) {
    if (deadline.expired()) {
      deadlineHit = true;
      errorMessage = `Context deadline reached after ${completedSymbols.length}/${rows.length} instruments.`;
      break;
    }
    try {
      const result = await evaluateInstrument(admin, instrument, rulebook, macroEvents, runId);
      completedSymbols.push(instrument.symbol);
      for (const failure of result.gates.filter(
        (candidate) => !candidate.passed && DATA_AVAILABILITY_GATES.has(candidate.code),
      )) {
        dataUnavailableSymbols.add(instrument.symbol);
        dataAvailabilityFailures.push({
          instrument: instrument.symbol,
          gate: failure.code,
          reason: failure.reason,
        });
      }
      const failed = armingFailedGates(result.gates);
      rejectionCount += failed.length;
      for (const f of failed) {
        runRejections.push({ instrument: instrument.symbol, gate: f.code, reason: f.reason });
      }

      if (!result.candidate) {
        await saveRejections(admin, failed, {
          candidateId: null,
          runId,
          instrument: instrument.symbol,
          timeframe: TIMEFRAME_LABEL[ENTRY_TF],
        });
        continue;
      }

      candidates += 1;
      const candidateId = await saveCandidate(admin, result.candidate, {
        runId,
        rulebookVersion: rulebook.version,
        rulebookChecksum: checksum,
        shadowMode,
      });
      await saveRejections(admin, failed, {
        candidateId,
        runId,
        instrument: instrument.symbol,
        timeframe: result.candidate.timeframe,
      });

      if (!result.candidate.qualified) continue;
      qualifiedCount += 1;

      // Shadow mode never issues an actionable alert and never consumes a slot.
      if (shadowMode) {
        await promoteToSignal(admin, result.candidate, {
          candidateId,
          runId,
          rulebookVersion: rulebook.version,
          rulebookChecksum: checksum,
          shadowMode,
          macroContext: result.macroContext,
        });
        continue;
      }

      // Live mode: the scan no longer alerts. It arms the setup and hands
      // execution timing to the precision loop, which is the only place a
      // signal may become actionable. Daily allowances are claimed there too,
      // so an armed setup that never triggers cannot consume one.
      const armedAt = new Date();
      const precision = result.precision;
      const signalId = await promoteToSignal(admin, result.candidate, {
        candidateId,
        runId,
        rulebookVersion: rulebook.version,
        rulebookChecksum: checksum,
        shadowMode,
        macroContext: result.macroContext,
        precision: {
          preferredEntry: precision?.preferredEntry ?? null,
          zoneWidthPoints: precision?.zoneWidthPoints ?? null,
          invalidation: precision?.invalidation.condition ?? null,
          invalidationPrice: precision?.invalidation.price ?? null,
          invalidationTimeframe: precision?.invalidation.timeframe ?? null,
          lifecycleState: "ARMED",
          armedAt: armedAt.toISOString(),
        },
      });

      if (signalId && precision) {
        armed += 1;
        await openPrecisionWatch(admin, {
          signal_id: signalId,
          symbol: result.candidate.instrument,
          broker_symbol: precision.brokerSymbol,
          direction: result.candidate.direction,
          state: "ARMED",
          armed_at: armedAt.toISOString(),
          expires_at: armedExpiry(armedAt, precision.armedExpiryMinutes),
          entry_anchor: precision.preferredEntry,
          anchor_source: precision.anchorSource,
          preferred_entry: precision.preferredEntry,
          arming_zone_low: precision.armingZoneLow,
          arming_zone_high: precision.armingZoneHigh,
          // The final narrow execution zone does not exist until M1 breaks a
          // level. The context band remains on the signal as a provisional
          // plan, but is never mistaken for the M1 trigger area.
          entry_zone_low: null,
          entry_zone_high: null,
          zone_width_points: precision.zoneWidthPoints,
          stop_loss: result.candidate.stop_loss,
          targets: result.candidate.targets as never,
          structural_level: precision.structuralLevel,
          structural_idea_id: result.candidate.fingerprint,
          invalidation_price: precision.invalidation.price,
          invalidation_condition: precision.invalidation.condition,
          invalidation_timeframe: precision.invalidation.timeframe,
          provisional_score: result.candidate.score,
          provisional_grade: result.candidate.grade,
          metadata: {
            grade: result.candidate.grade,
            setup_type: result.candidate.setup_type,
            score: result.candidate.score,
            rr_tp1: result.candidate.rr_tp1,
            reasons: result.candidate.reasons,
            // Structural score inputs are fixed at arming; the precision loop
            // re-scores with these plus live execution readings.
            score_input: precision.scoreInput,
          } as never,
        });

        if (alertTestMode) {
          // Best-effort and clearly labelled. A failure here must never stop
          // a scan, and it never marks the signal actionable.
          const { notifyQualifiedSignal } = await import("./notify.server");
          const delivery = await notifyQualifiedSignal(admin, {
            shadowMode: false,
            test: true,
            signalId,
            instrument: result.candidate.instrument,
            direction: result.candidate.direction,
            grade: result.candidate.grade,
            setupType: result.candidate.setup_type,
            timeframe: result.candidate.timeframe,
            entryZoneLow: result.candidate.entry_zone_low,
            entryZoneHigh: result.candidate.entry_zone_high,
            stopLoss: result.candidate.stop_loss,
            targets: (result.candidate.targets ?? []) as number[],
            rr: result.candidate.rr_tp1,
            score: result.candidate.score,
            reasons: result.candidate.reasons ?? [],
          }).catch((error) => {
            console.error(
              "armed test alert failed",
              error instanceof Error ? error.message : "unknown",
            );
            return null;
          });
          await admin.from("audit_log").insert({
            actor_kind: "SYSTEM",
            action: "ALERT_TEST_DELIVERY",
            entity_type: "signal",
            entity_id: signalId,
            detail: {
              instrument: result.candidate.instrument,
              tier: result.candidate.grade,
              delivery,
            } as never,
          });
        }
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "scan failed";
      await recordScannerError(admin, {
        runId,
        instrument: instrument.symbol,
        stage: "EVALUATION",
        error,
      });
      console.error(`scan failed for ${instrument.symbol}`, errorMessage);
    }
  }

  const dataAvailabilityMessage =
    dataUnavailableSymbols.size > 0
      ? `Durable candle data unavailable for ${[...dataUnavailableSymbols].join(", ")}.`
      : null;
  const runDegraded = Boolean(errorMessage) || deadlineHit || dataUnavailableSymbols.size > 0;
  const finalErrorMessage = errorMessage ?? dataAvailabilityMessage;

  await finishRun(admin, runId, {
    status: runDegraded ? "PARTIAL" : "SUCCESS",
    signals_emitted: qualifiedCount,
    rejections: runRejections,
    error_message: finalErrorMessage,
  });

  await safeHeartbeat(admin, {
    source: "CONTEXT_SCANNER",
    status: runDegraded ? "DEGRADED" : "OK",
    metaapiConnected: null,
    rulebookVersion: rulebook.version,
    detail: {
      shadow_mode: shadowMode,
      rulebook_checksum: checksum,
      session: sessionAt(new Date()),
      instruments: symbols,
      // Completion telemetry: a SKIPPED heartbeat must never hide when the
      // last full context scan actually finished, or how long it took.
      completed_symbols: completedSymbols,
      symbols_completed: completedSymbols.length,
      symbols_started: symbols.length,
      pending_symbols: symbols.filter((symbol) => !completedSymbols.includes(symbol)),
      deadline_hit: deadlineHit,
      duration_ms: Date.now() - startedAtMs,
      completed_at: new Date().toISOString(),
      lock_holder: holder,
      candidates,
      qualified: qualifiedCount,
      armed,
      rejections: rejectionCount,
      fresh_symbols: completedSymbols.filter((symbol) => !dataUnavailableSymbols.has(symbol)),
      data_unavailable_symbols: [...dataUnavailableSymbols],
      data_availability_failures: dataAvailabilityFailures,
      macro_events: macroEvents.length,
      market_data_source: "DURABLE_STORE",
    },
  });

  return {
    ok: true,
    shadowMode,
    scanned: symbols,
    candidates,
    qualified: qualifiedCount,
    actionable,
    armed,
    rejections: rejectionCount,
    message: finalErrorMessage ?? undefined,
  };
}
