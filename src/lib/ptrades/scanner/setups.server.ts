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
 *
 * CHRONOLOGY IS A CORRECTNESS RULE, NOT A REFINEMENT. Every family orders its
 * events by candle index: sweep -> displacement -> retest, or break ->
 * displacement -> retest. A retest may never be the break candle itself, and a
 * displacement may never predate the event it is meant to confirm.
 */

export type SetupType =
  | "SWEEP_DISPLACEMENT_RETEST"
  | "PULLBACK_CONTINUATION"
  | "BREAK_RETEST";

/** Ordered candle indices of the structural events that formed this setup. */
export type SetupSequence = {
  sweepIndex: number | null;
  breakIndex: number | null;
  displacementIndex: number | null;
  retestIndex: number | null;
};

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
  /** Candle indices of each event, for chronology proof and replay. */
  sequence: SetupSequence;
  /** True when every present event is in a valid, strictly increasing order. */
  sequenceValid: boolean;
  detail: Record<string, unknown>;
};

const EMPTY_SEQUENCE: SetupSequence = {
  sweepIndex: null,
  breakIndex: null,
  displacementIndex: null,
  retestIndex: null,
};

/**
 * Validates the chronology of whatever events are present. Missing events are
 * not failures — an armed setup legitimately has no retest yet — but a present
 * event that is out of order is.
 */
export function validateSequence(seq: SetupSequence): boolean {
  const anchor = seq.sweepIndex ?? seq.breakIndex;
  if (seq.sweepIndex !== null && seq.breakIndex !== null && seq.breakIndex < seq.sweepIndex) {
    return false;
  }
  if (seq.displacementIndex !== null && anchor !== null && seq.displacementIndex < anchor) {
    return false;
  }
  if (seq.retestIndex !== null) {
    if (anchor === null) return false;
    // A retest must land on a LATER candle than the break/sweep it retests.
    if (seq.retestIndex <= anchor) return false;
    if (seq.breakIndex !== null && seq.retestIndex <= seq.breakIndex) return false;
    if (seq.displacementIndex !== null && seq.retestIndex <= seq.displacementIndex) return false;
  }
  return true;
}

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
    sequence: { ...EMPTY_SEQUENCE },
    sequenceValid: true,
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
  // Displacement must occur on or after the sweep candle: the sweep candle can
  // itself be the reclaim impulse, but nothing before it can confirm it.
  const displacement = detectDisplacement(
    candles,
    direction,
    atr,
    displacementMinAtr,
    5,
    sweep.sweptIndex,
  );
  // Retest must be strictly after both the sweep and the displacement.
  const after = Math.max(sweep.sweptIndex ?? -1, displacement.atIndex ?? -1);
  const retest = detectRetest(candles, direction, sweep.level, atr, 6, after);

  const sequence: SetupSequence = {
    sweepIndex: sweep.sweptIndex,
    breakIndex: null,
    displacementIndex: displacement.atIndex,
    retestIndex: retest.atIndex,
  };

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
    sequence,
    sequenceValid: validateSequence(sequence),
    detail: {
      sweptAt: sweep.sweptAt,
      displacedAt: displacement.at,
      retestAt: retest.at,
      sequence,
      armableWithoutRetest: displacement.found && !retest.found,
    },
  };
}

/** Shared body for the two structure-break families. */
function breakFamily(
  input: SetupInput,
  setupType: "PULLBACK_CONTINUATION" | "BREAK_RETEST",
  requireBosInDirection: Bias | null,
): SetupResult {
  const { candles, atr, swingLookback, displacementMinAtr } = input;
  const structure = detectStructureEvent(candles, swingLookback);

  if (!structure.found || !structure.direction) {
    return empty(setupType, { structure: structure.type, priorTrend: structure.priorTrend });
  }
  if (requireBosInDirection) {
    if (structure.type !== "BOS" || structure.direction !== requireBosInDirection) {
      return empty(setupType, { structure: structure.type, bias: requireBosInDirection });
    }
  }

  const direction = structure.direction;
  const displacement = detectDisplacement(
    candles,
    direction,
    atr,
    displacementMinAtr,
    5,
    structure.atIndex,
  );
  const after = Math.max(structure.atIndex ?? -1, displacement.atIndex ?? -1);
  const retest = detectRetest(candles, direction, structure.level, atr, 6, after);

  const highs = swingHighs(candles, swingLookback);
  const lows = swingLows(candles, swingLookback);
  const extreme =
    direction === "LONG" ? (lows.at(-1)?.price ?? null) : (highs.at(-1)?.price ?? null);

  const sequence: SetupSequence = {
    sweepIndex: null,
    breakIndex: structure.atIndex,
    displacementIndex: displacement.atIndex,
    retestIndex: retest.atIndex,
  };

  return {
    found: displacement.found && retest.found,
    setupType,
    direction,
    level: structure.level,
    extreme,
    entryLow: retest.entryLow,
    entryHigh: retest.entryHigh,
    sweepFound: false,
    displacementAtr: displacement.bodyAtr,
    retestFound: retest.found,
    structureType: structure.type,
    sequence,
    sequenceValid: validateSequence(sequence),
    detail: {
      brokeAt: structure.at,
      displacedAt: displacement.at,
      retestAt: retest.at,
      structureType: structure.type,
      priorTrend: structure.priorTrend,
      sequence,
      armableWithoutRetest: displacement.found && !retest.found,
    },
  };
}

/** 7.3 — with-trend break of structure followed by a controlled pullback. */
export function detectPullbackContinuation(input: SetupInput): SetupResult {
  if (input.bias !== "LONG" && input.bias !== "SHORT") {
    return empty("PULLBACK_CONTINUATION", { bias: input.bias });
  }
  return breakFamily(input, "PULLBACK_CONTINUATION", input.bias);
}

/** 7.4 — support/resistance break that is retested and held. */
export function detectBreakRetest(input: SetupInput): SetupResult {
  return breakFamily(input, "BREAK_RETEST", null);
}

/** Result of running every family, with the selection reasoning preserved. */
export interface SetupDetectionResult {
  selected: SetupResult | null;
  completeResults: SetupResult[];
  armableResults: SetupResult[];
  diagnosticResults: SetupResult[];
  /** Families rejected purely because their events were out of order. */
  chronologyRejected: SetupResult[];
  /** Families rejected purely because the bias policy did not allow them. */
  biasRejected: SetupResult[];
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

export type SetupSelectionPolicy = {
  /** Rulebook arming policy, injected so this module stays policy-free. */
  isArmable?: (setup: SetupResult) => boolean;
  /** Bias eligibility. Returning false removes the family from selection. */
  isBiasEligible?: (setup: SetupResult) => boolean;
};

/**
 * Runs every family and selects in a strict hierarchy:
 *   A. the first COMPLETE setup;
 *   B. otherwise the best ARMABLE partial (armability is evaluated per family,
 *      never on a single pre-chosen "best partial");
 *   C. otherwise the best diagnostic partial, purely so the rejection row can
 *      explain what stopped.
 *
 * Families with an invalid event chronology, or that the bias policy rejects,
 * are excluded from A and B — they can still surface as C so the rejection row
 * names the real reason.
 */
export function detectSetupDetailed(
  input: SetupInput,
  policy: SetupSelectionPolicy | ((setup: SetupResult) => boolean) = {},
): SetupDetectionResult {
  const { isArmable = () => false, isBiasEligible = () => true } =
    typeof policy === "function" ? { isArmable: policy } : policy;

  const detectors = [
    detectSweepDisplacementRetest,
    detectPullbackContinuation,
    detectBreakRetest,
  ];
  const diagnosticResults = detectors.map((d) => d(input));

  const chronologyRejected = diagnosticResults.filter((r) => !r.sequenceValid);
  const chronological = diagnosticResults.filter((r) => r.sequenceValid);
  const biasRejected = chronological.filter((r) => r.direction !== null && !isBiasEligible(r));
  const eligible = chronological.filter((r) => r.direction === null || isBiasEligible(r));

  const completeResults = eligible.filter((r) => r.found);
  const armableResults = eligible.filter((r) => !r.found && isArmable(r));

  const base = {
    completeResults,
    armableResults,
    diagnosticResults,
    chronologyRejected,
    biasRejected,
  };

  if (completeResults.length > 0) {
    return { ...base, selected: completeResults[0], selectedFrom: "COMPLETE" };
  }
  const armable = bestBy(armableResults, setupProgress);
  if (armable) {
    return { ...base, selected: armable, selectedFrom: "ARMABLE" };
  }
  const diagnostic = bestBy(diagnosticResults, setupProgress);
  return {
    ...base,
    selected: diagnostic,
    selectedFrom: diagnostic ? "DIAGNOSTIC" : "NONE",
  };
}

/** Backwards-compatible single-result form. */
export function detectSetup(
  input: SetupInput,
  policy?: SetupSelectionPolicy | ((setup: SetupResult) => boolean),
): SetupResult {
  const result = detectSetupDetailed(input, policy);
  return result.selected ?? empty("SWEEP_DISPLACEMENT_RETEST");
}
