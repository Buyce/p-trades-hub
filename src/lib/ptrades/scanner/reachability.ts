/**
 * Tier reachability — a governance diagnostic, not a scoring path.
 *
 * Every hard gate a candidate must pass is also a scoring component, so a
 * candidate that survives all gates already carries a large floor score. If a
 * tier's score band sits below that floor, or above the highest score any
 * gate-passing candidate can reach, that tier can never fire no matter what
 * the market does. This computes the reachable window from the active rulebook
 * using the scanner's own weights and flags dead bands.
 *
 * It never scores, re-scores or re-grades a signal.
 */

import { scoreCandidate, type ScoreInput } from "./scoring";
import type { Rulebook } from "./types";
import { TIERS, type Tier } from "@/lib/ptrades/tiers";

/** Highest reward-to-risk the structural target ladder will accept. */
const MAX_TARGET_RR = 6;

/** Weakest inputs a candidate can have while still passing every hard gate. */
function worstPassingInput(rulebook: Rulebook): ScoreInput {
  return {
    // Bias gate forces higher-timeframe agreement; D1 agreement is optional.
    biasAligned: true,
    d1Aligned: false,
    // Setup families other than sweep/displacement/retest pass without a sweep.
    sweepFound: false,
    retestFound: true,
    displacementAtr: rulebook.displacement_min_atr,
    rr: Math.min(...TIERS.map((t) => rulebook.tier_min_rr[t])),
    spreadRatio: rulebook.max_spread_atr_ratio,
    lateDistanceAtr: rulebook.late_entry_max_atr_from_entry,
    macroAligned: false,
  };
}

/** Strongest inputs any candidate can present. */
function bestPassingInput(rulebook: Rulebook): ScoreInput {
  return {
    biasAligned: true,
    d1Aligned: true,
    sweepFound: true,
    retestFound: true,
    displacementAtr: rulebook.displacement_min_atr * 3,
    rr: MAX_TARGET_RR,
    spreadRatio: 0,
    lateDistanceAtr: 0,
    macroAligned: true,
  };
}

export type TierReachability = {
  tier: Tier;
  band: number;
  reachable: boolean;
  note: string;
};

export type ReachabilityReport = {
  min: number;
  max: number;
  tiers: TierReachability[];
  /** True when at least one tier band can never be produced. */
  hasDeadBand: boolean;
};

export function reachableScoreRange(rulebook: Rulebook): { min: number; max: number } {
  return {
    min: scoreCandidate(worstPassingInput(rulebook), rulebook).score,
    max: scoreCandidate(bestPassingInput(rulebook), rulebook).score,
  };
}

export function tierReachability(rulebook: Rulebook): ReachabilityReport {
  const { min, max } = reachableScoreRange(rulebook);
  const tiers = TIERS.map<TierReachability>((tier) => {
    const band = rulebook.grades[tier];
    // A tier fires when a gate-passing score lands in its band. The band's
    // ceiling is the next tier up, so only the top and bottom edges can die.
    const above = band > max;
    const below = tier === "C" && band < min;
    const reachable = !above && !below;
    return {
      tier,
      band,
      reachable,
      note: above
        ? `Band starts at ${band} but no gate-passing candidate can score above ${max}.`
        : below
          ? `Band starts at ${band}, below the ${min} floor every gate-passing candidate already clears, so no setup can land in it.`
          : `Band ${band} sits inside the reachable ${min}–${max} window.`,
    };
  });

  return { min, max, tiers, hasDeadBand: tiers.some((t) => !t.reachable) };
}
