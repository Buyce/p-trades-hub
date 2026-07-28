import type { Rulebook } from "./types";

/**
 * Deterministic qualification score on the Master Handoff 100-point budget.
 * Same inputs always produce the same score and grade. Nothing here is random,
 * adaptive or time-dependent. The score is a qualification score, never a win
 * probability.
 *
 * Weights: HTF alignment 20, liquidity quality 20, structure confirmation 15,
 * displacement strength 15, retest quality 15, macro alignment 10, execution
 * quality 5.
 */

export type ScoreInput = {
  rr: number | null;
  biasAligned: boolean;
  d1Aligned: boolean;
  displacementAtr: number | null;
  sweepFound: boolean;
  retestFound: boolean;
  spreadRatio: number | null;
  lateDistanceAtr: number | null;
  /** Reserved: macro alignment is not evaluated yet and always scores 0. */
  macroAligned?: boolean;
};

export type Grade = "A_PLUS" | "A" | "B" | "C";

export type ScoreOutput = {
  score: number;
  grade: Grade | null;
  components: Record<string, number>;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Maps a score to A+, A, B, C or null (reject) using the active rulebook bands. */
export function gradeForScore(score: number, rulebook: Rulebook): Grade | null {
  if (score >= rulebook.grades.A_PLUS) return "A_PLUS";
  if (score >= rulebook.grades.A) return "A";
  if (score >= rulebook.grades.B) return "B";
  if (score >= rulebook.grades.C) return "C";
  return null;
}

const TIER_ORDER: Grade[] = ["A_PLUS", "A", "B", "C"];

/**
 * Resolves the tier a candidate actually earns. A tier requires BOTH its score
 * band and its reward-to-risk floor; only the RR floor differs between tiers,
 * every hard safety gate is identical. Returns null when no tier is satisfied.
 */
export function tierFor(score: number, rr: number | null, rulebook: Rulebook): Grade | null {
  const scoreGrade = gradeForScore(score, rulebook);
  if (!scoreGrade) return null;
  if (rr === null) return null;
  const start = TIER_ORDER.indexOf(scoreGrade);
  for (let i = start; i < TIER_ORDER.length; i += 1) {
    const tier = TIER_ORDER[i];
    if (rr >= rulebook.tier_min_rr[tier]) return tier;
  }
  return null;
}

/** The lowest reward-to-risk any tier accepts — the hard RR gate floor. */
export function minTierRr(rulebook: Rulebook): number {
  return Math.min(...TIER_ORDER.map((t) => rulebook.tier_min_rr[t]));
}

export function scoreCandidate(input: ScoreInput, rulebook: Rulebook): ScoreOutput {
  const components: Record<string, number> = {
    // Higher-timeframe alignment (20).
    htf_alignment: (input.biasAligned ? 12 : 0) + (input.d1Aligned ? 8 : 0),
    // Liquidity quality (20): a confirmed sweep of a prior swing.
    liquidity_quality: input.sweepFound ? 20 : 0,
    // Structure confirmation (15), expressed through reward-to-risk geometry:
    // 2.0R scores half, 4.0R and above scores the full weight.
    structure_confirmation:
      input.rr === null ? 0 : clamp(((input.rr - 2) / 2) * 7.5 + 7.5, 0, 15),
    // Displacement strength (15), relative to the rulebook minimum.
    displacement_strength:
      input.displacementAtr === null
        ? 0
        : clamp((input.displacementAtr / rulebook.displacement_min_atr) * 15, 0, 15),
    // Retest quality (15).
    retest_quality: input.retestFound ? 15 : 0,
    // Macro alignment (10) — reserved until the macro calendar is wired.
    macro_alignment: input.macroAligned ? 10 : 0,
    // Execution quality (5): spread 3, entry timing 2.
    execution_quality:
      (input.spreadRatio === null
        ? 0
        : clamp((1 - input.spreadRatio / rulebook.max_spread_atr_ratio) * 3, 0, 3)) +
      (input.lateDistanceAtr === null
        ? 0
        : clamp(
            (1 - input.lateDistanceAtr / rulebook.late_entry_max_atr_from_entry) * 2,
            0,
            2,
          )),
  };

  const score = Number(
    Object.values(components)
      .reduce((a, b) => a + b, 0)
      .toFixed(2),
  );

  return { score, grade: gradeForScore(score, rulebook), components };
}
