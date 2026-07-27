import type { Rulebook } from "./types";

/**
 * Deterministic qualification score. Same inputs always produce the same score
 * and grade. Nothing here is random, adaptive or time-dependent.
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
};

export type ScoreOutput = {
  score: number;
  grade: "A_PLUS" | "A" | "B" | null;
  components: Record<string, number>;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function scoreCandidate(input: ScoreInput, rulebook: Rulebook): ScoreOutput {
  const components: Record<string, number> = {
    // Reward-to-risk: 2.0R scores 20, 4.0R and above scores the full 30.
    reward_to_risk: input.rr === null ? 0 : clamp(((input.rr - 2) / 2) * 10 + 20, 0, 30),
    // Higher-timeframe alignment.
    htf_bias: input.biasAligned ? 15 : 0,
    daily_bias: input.d1Aligned ? 10 : 0,
    // Structure quality.
    liquidity_sweep: input.sweepFound ? 15 : 0,
    displacement:
      input.displacementAtr === null
        ? 0
        : clamp((input.displacementAtr / rulebook.displacement_min_atr) * 15, 0, 20),
    retest: input.retestFound ? 10 : 0,
    // Execution quality.
    spread_quality:
      input.spreadRatio === null
        ? 0
        : clamp((1 - input.spreadRatio / rulebook.max_spread_atr_ratio) * 8, 0, 8),
    entry_timing:
      input.lateDistanceAtr === null
        ? 0
        : clamp(
            (1 - input.lateDistanceAtr / rulebook.late_entry_max_atr_from_entry) * 7,
            0,
            7,
          ),
  };

  const score = Number(
    Object.values(components)
      .reduce((a, b) => a + b, 0)
      .toFixed(2),
  );

  const grade =
    score >= rulebook.grades.A_PLUS
      ? "A_PLUS"
      : score >= rulebook.grades.A
        ? "A"
        : score >= rulebook.grades.B
          ? "B"
          : null;

  return { score, grade, components };
}
