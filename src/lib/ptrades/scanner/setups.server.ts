import type { Bias, Candle } from "./types";
import { detectSweep } from "./sweep.server";
import { detectDisplacement } from "./displacement.server";
import { detectRetest } from "./retest.server";
import { detectStructureEvent } from "./structure.server";
import { swingHighs, swingLows } from "./swings.server";

/**
 * Setup families. Each detector is deterministic and pure: candles, ATR and the
 * higher-timeframe bias in, one structured setup out. No detector decides
 * whether to alert — the gates and the score do that downstream.
 *
 * 7.1/7.2  SWEEP_DISPLACEMENT_RETEST — liquidity sweep, impulsive displacement,
 *          retest of the reclaimed level.
 * 7.3      PULLBACK_CONTINUATION — with-trend break of structure, then a
 *          controlled pullback into the broken level.
 * 7.4      BREAK_RETEST — support/resistance break (BOS or ChoCH) that is
 *          retested and held, without requiring a prior sweep.
 */

export type SetupType =
  | "SWEEP_DISPLACEMENT_RETEST"
  | "PULLBACK_CONTINUATION"
  | "BREAK_RETEST";

export type SetupResult = {
  found: boolean;
  setupType: SetupType;
  direction: "LONG" | "SHORT" | null;
  level: number | null;
  extreme: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  sweepFound: boolean;
  displacementAtr: number | null;
  retestFound: boolean;
  structureType: "BOS" | "CHOCH" | null;
  detail: Record<string, unknown>;
};

function empty(setupType: SetupType, detail: Record<string, unknown> = {}): SetupResult {
  return {
    found: false,
    setupType,
    direction: null,
    level: null,
    extreme: null,
    entryLow: null,
    entryHigh: null,
    sweepFound: false,
    displacementAtr: null,
    retestFound: false,
    structureType: null,
    detail,
  };
}

export type SetupInput = {
  candles: Candle[];
  atr: number | null;
  bias: Bias;
  swingLookback: number;
  displacementMinAtr: number;
};

/** 7.1 / 7.2 — sweep, displacement, retest. */
export function detectSweepDisplacementRetest(input: SetupInput): SetupResult {
  const { candles, atr, swingLookback, displacementMinAtr } = input;
  const sweep = detectSweep(candles, swingLookback);
  if (!sweep.found || !sweep.direction) return empty("SWEEP_DISPLACEMENT_RETEST");

  const direction = sweep.direction;
  const displacement = detectDisplacement(candles, direction, atr, displacementMinAtr);
  const retest = detectRetest(candles, direction, sweep.level, atr);

  return {
    found: displacement.found && retest.found,
    setupType: "SWEEP_DISPLACEMENT_RETEST",
    direction,
    level: sweep.level,
    extreme: sweep.extreme,
    entryLow: retest.entryLow,
    entryHigh: retest.entryHigh,
    sweepFound: true,
    displacementAtr: displacement.bodyAtr,
    retestFound: retest.found,
    structureType: null,
    detail: { sweptAt: sweep.sweptAt, displacedAt: displacement.at, retestAt: retest.at },
  };
}

/** 7.3 — with-trend break of structure followed by a controlled pullback. */
export function detectPullbackContinuation(input: SetupInput): SetupResult {
  const { candles, atr, bias, swingLookback, displacementMinAtr } = input;
  if (bias !== "LONG" && bias !== "SHORT") return empty("PULLBACK_CONTINUATION", { bias });

  const structure = detectStructureEvent(candles, swingLookback);
  // Continuation requires a break in the direction of the higher-timeframe bias
  // that continues the existing trend (BOS), not a reversal (ChoCH).
  if (!structure.found || structure.type !== "BOS" || structure.direction !== bias) {
    return empty("PULLBACK_CONTINUATION", { structure: structure.type, bias });
  }

  const direction = bias;
  const displacement = detectDisplacement(candles, direction, atr, displacementMinAtr);
  const retest = detectRetest(candles, direction, structure.level, atr);
  const highs = swingHighs(candles, swingLookback);
  const lows = swingLows(candles, swingLookback);
  const extreme =
    direction === "LONG" ? (lows.at(-1)?.price ?? null) : (highs.at(-1)?.price ?? null);

  if (!atr || !displacement.found || !retest.found) {
    return {
      found: false,
      setupType: "PULLBACK_CONTINUATION",
      direction,
      level: structure.level,
      extreme,
      entryLow: retest.entryLow,
      entryHigh: retest.entryHigh,
      sweepFound: false,
      displacementAtr: displacement.bodyAtr,
      retestFound: retest.found,
      structureType: "BOS",
      detail: {
        brokeAt: structure.at,
        retestAt: retest.at,
        priorTrend: structure.priorTrend,
        armableWithoutRetest: displacement.found && !retest.found,
      },
    };
  }

  return {
    found: true,
    setupType: "PULLBACK_CONTINUATION",
    direction,
    level: structure.level,
    extreme,
    entryLow: retest.entryLow,
    entryHigh: retest.entryHigh,
    sweepFound: false,
    displacementAtr: displacement.bodyAtr,
    retestFound: true,
    structureType: "BOS",
    detail: { brokeAt: structure.at, retestAt: retest.at, priorTrend: structure.priorTrend },
  };
}

/** 7.4 — support/resistance break that is retested and held. */
export function detectBreakRetest(input: SetupInput): SetupResult {
  const { candles, atr, swingLookback, displacementMinAtr } = input;
  const structure = detectStructureEvent(candles, swingLookback);
  if (!structure.found || !structure.direction) return empty("BREAK_RETEST");

  const direction = structure.direction;
  const displacement = detectDisplacement(candles, direction, atr, displacementMinAtr);
  const retest = detectRetest(candles, direction, structure.level, atr);
  const highs = swingHighs(candles, swingLookback);
  const lows = swingLows(candles, swingLookback);
  const extreme =
    direction === "LONG" ? (lows.at(-1)?.price ?? null) : (highs.at(-1)?.price ?? null);

  if (!displacement.found || !retest.found) {
    return {
      found: false,
      setupType: "BREAK_RETEST",
      direction,
      level: structure.level,
      extreme,
      entryLow: retest.entryLow,
      entryHigh: retest.entryHigh,
      sweepFound: false,
      displacementAtr: displacement.bodyAtr,
      retestFound: retest.found,
      structureType: structure.type,
      detail: {
        brokeAt: structure.at,
        retestAt: retest.at,
        structureType: structure.type,
        armableWithoutRetest: displacement.found && !retest.found,
      },
    };
  }

  return {
    found: true,
    setupType: "BREAK_RETEST",
    direction,
    level: structure.level,
    extreme,
    entryLow: retest.entryLow,
    entryHigh: retest.entryHigh,
    sweepFound: false,
    displacementAtr: displacement.bodyAtr,
    retestFound: true,
    structureType: structure.type,
    detail: { brokeAt: structure.at, retestAt: retest.at, structureType: structure.type },
  };
}

/** Result of running every family, with the selection reasoning preserved. */
export interface SetupDetectionResult {
  selected: SetupResult | null;
  completeResults: SetupResult[];
  armableResults: SetupResult[];
  diagnosticResults: SetupResult[];
  /** Which branch of the hierarchy produced `selected`. */
  selectedFrom: "COMPLETE" | "ARMABLE" | "DIAGNOSTIC" | "NONE";
}

/** How far a family progressed. Diagnostics only — never an arming decision. */
export function setupProgress(r: SetupResult): number {
  return (
    (r.retestFound ? 4 : 0) +
    (r.sweepFound ? 2 : 0) +
    (r.structureType !== null ? 1 : 0) +
    (r.displacementAtr !== null ? 1 : 0)
  );
}

function bestBy(results: SetupResult[], rank: (r: SetupResult) => number): SetupResult | null {
  if (results.length === 0) return null;
  return results.reduce((best, r) => (rank(r) > rank(best) ? r : best), results[0]);
}

/**
 * Runs every family and selects in a strict hierarchy:
 *   A. the first COMPLETE setup;
 *   B. otherwise the best ARMABLE partial (armability is evaluated per family,
 *      never on a single pre-chosen "best partial");
 *   C. otherwise the best diagnostic partial, purely so the rejection row can
 *      explain what stopped.
 *
 * `isArmable` is injected so this module stays free of rulebook policy.
 */
export function detectSetupDetailed(
  input: SetupInput,
  isArmable: (setup: SetupResult) => boolean = () => false,
): SetupDetectionResult {
  const detectors = [
    detectSweepDisplacementRetest,
    detectPullbackContinuation,
    detectBreakRetest,
  ];
  const diagnosticResults = detectors.map((d) => d(input));
  const completeResults = diagnosticResults.filter((r) => r.found);
  const armableResults = diagnosticResults.filter((r) => !r.found && isArmable(r));

  if (completeResults.length > 0) {
    return {
      selected: completeResults[0],
      completeResults,
      armableResults,
      diagnosticResults,
      selectedFrom: "COMPLETE",
    };
  }
  const armable = bestBy(armableResults, setupProgress);
  if (armable) {
    return {
      selected: armable,
      completeResults,
      armableResults,
      diagnosticResults,
      selectedFrom: "ARMABLE",
    };
  }
  const diagnostic = bestBy(diagnosticResults, setupProgress);
  return {
    selected: diagnostic,
    completeResults,
    armableResults,
    diagnosticResults,
    selectedFrom: diagnostic ? "DIAGNOSTIC" : "NONE",
  };
}

/** Backwards-compatible single-result form. */
export function detectSetup(
  input: SetupInput,
  isArmable?: (setup: SetupResult) => boolean,
): SetupResult {
  const result = detectSetupDetailed(input, isArmable);
  return result.selected ?? empty("SWEEP_DISPLACEMENT_RETEST");
}

