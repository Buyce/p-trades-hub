import type { Rulebook } from "./types";
import type { SetupType } from "./setups.server";

/**
 * Per-family qualification scorecards.
 *
 * WHY PER FAMILY. A single shared 100-point budget awarded "liquidity quality"
 * to setups that never swept liquidity and spent 15 points on reward-to-risk
 * geometry that the tier gate already enforces. The result was arithmetic, not
 * policy: whole grade bands became unreachable for whole families.
 *
 * RULES OF THE SCORECARD
 *  - Every family's weights sum to exactly 100.
 *  - Reward-to-risk is NOT scored. R:R is a per-tier hard floor, not quality.
 *  - A component may only be awarded to a family that can actually produce it
 *    (no sweep points for a break-and-retest).
 *  - Every grade band must be reachable for every family; `reachableGrades`
 *    proves it and the rulebook validator refuses configurations where it is
 *    not.
 *
 * The score is a qualification score, never a win probability.
 */

export type Grade = "A_PLUS" | "A" | "B" | "C";

export type ScoreInput = {
  /** Retained for callers/telemetry. Deliberately NOT scored. */
  rr?: number | null;
  setupType?: SetupType;
  biasAligned: boolean;
  d1Aligned: boolean;
  displacementAtr: number | null;
  sweepFound: boolean;
  retestFound: boolean;
  structureType?: "BOS" | "CHOCH" | null;
  spreadRatio: number | null;
  lateDistanceAtr: number | null;
  macroAligned?: boolean;
};

export type ScoreOutput = {
  score: number;
  grade: Grade | null;
  components: Record<string, number>;
  family: SetupType;
};

export type Scorecard = {
  htf_h4: number;
  htf_d1: number;
  liquidity_sweep: number;
  structure_break: number;
  displacement_strength: number;
  retest_quality: number;
  macro_alignment: number;
  execution_spread: number;
  execution_timing: number;
};

/** Weights per family. Each column sums to 100 — asserted by `assertScorecards`. */
export const SCORECARDS: Record<SetupType, Scorecard> = {
  SWEEP_DISPLACEMENT_RETEST: {
    htf_h4: 12,
    htf_d1: 8,
    liquidity_sweep: 25,
    structure_break: 0,
    displacement_strength: 20,
    retest_quality: 20,
    macro_alignment: 10,
    execution_spread: 3,
    execution_timing: 2,
  },
  PULLBACK_CONTINUATION: {
    htf_h4: 18,
    htf_d1: 12,
    liquidity_sweep: 0,
    structure_break: 20,
    displacement_strength: 20,
    retest_quality: 20,
    macro_alignment: 5,
    execution_spread: 3,
    execution_timing: 2,
  },
  BREAK_RETEST: {
    htf_h4: 12,
    htf_d1: 8,
    liquidity_sweep: 0,
    structure_break: 25,
    displacement_strength: 20,
    retest_quality: 25,
    macro_alignment: 5,
    execution_spread: 3,
    execution_timing: 2,
  },
};

export function scorecardTotal(card: Scorecard): number {
  return Object.values(card).reduce((a, b) => a + b, 0);
}

/** Throws when any family's budget is not exactly 100. */
export function assertScorecards(cards: Record<SetupType, Scorecard> = SCORECARDS): void {
  for (const [family, card] of Object.entries(cards)) {
    const total = scorecardTotal(card);
    if (Math.abs(total - 100) > 1e-9) {
      throw new Error(`Scorecard for ${family} sums to ${total}, not 100.`);
    }
  }
}

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

export function scorecardFor(family: SetupType | undefined): Scorecard {
  return SCORECARDS[family ?? "SWEEP_DISPLACEMENT_RETEST"];
}

export function scoreCandidate(input: ScoreInput, rulebook: Rulebook): ScoreOutput {
  const family: SetupType = input.setupType ?? "SWEEP_DISPLACEMENT_RETEST";
  const card = scorecardFor(family);

  const displacementRatio =
    input.displacementAtr === null || rulebook.displacement_min_atr <= 0
      ? 0
      : clamp(input.displacementAtr / rulebook.displacement_min_atr, 0, 1);

  // A change of character is a weaker structural claim than a clean break of
  // structure, so it earns four fifths of the structure budget.
  const structureFactor =
    card.structure_break === 0
      ? 0
      : input.structureType === "BOS"
        ? 1
        : input.structureType === "CHOCH"
          ? 0.8
          : 0;

  const components: Record<string, number> = {
    htf_alignment: (input.biasAligned ? card.htf_h4 : 0) + (input.d1Aligned ? card.htf_d1 : 0),
    liquidity_sweep: input.sweepFound ? card.liquidity_sweep : 0,
    structure_break: card.structure_break * structureFactor,
    displacement_strength: card.displacement_strength * displacementRatio,
    retest_quality: input.retestFound ? card.retest_quality : 0,
    macro_alignment: input.macroAligned ? card.macro_alignment : 0,
    execution_quality:
      (input.spreadRatio === null || rulebook.max_spread_atr_ratio <= 0
        ? 0
        : clamp((1 - input.spreadRatio / rulebook.max_spread_atr_ratio) * card.execution_spread, 0, card.execution_spread)) +
      (input.lateDistanceAtr === null || rulebook.late_entry_max_atr_from_entry <= 0
        ? 0
        : clamp(
            (1 - input.lateDistanceAtr / rulebook.late_entry_max_atr_from_entry) *
              card.execution_timing,
            0,
            card.execution_timing,
          )),
  };

  for (const key of Object.keys(components)) {
    components[key] = Number(components[key].toFixed(2));
  }

  const score = Number(
    Object.values(components)
      .reduce((a, b) => a + b, 0)
      .toFixed(2),
  );

  return { score, grade: gradeForScore(score, rulebook), components, family };
}

/**
 * Every grade a family can actually reach at ENTRY_READY. Enumerated over the
 * discrete quality dimensions a real setup varies across; a band missing from
 * this set is a dead band and the rulebook validator rejects the configuration.
 */
export function reachableGrades(family: SetupType, rulebook: Rulebook): Set<Grade> {
  const reached = new Set<Grade>();
  const bools = [false, true];
  const displacements = [0, 0.5, 0.8, 1, 1.6];
  for (const biasAligned of bools) {
    for (const d1Aligned of bools) {
      for (const macroAligned of bools) {
        for (const d of displacements) {
          for (const structureType of ["BOS", "CHOCH"] as const) {
            for (const spreadRatio of [0, rulebook.max_spread_atr_ratio * 0.5]) {
              const { score } = scoreCandidate(
                {
                  setupType: family,
                  biasAligned,
                  d1Aligned,
                  macroAligned,
                  displacementAtr: d * rulebook.displacement_min_atr,
                  // ENTRY_READY always has its retest; the sweep component only
                  // exists for the sweep family.
                  sweepFound: family === "SWEEP_DISPLACEMENT_RETEST",
                  retestFound: true,
                  structureType: family === "SWEEP_DISPLACEMENT_RETEST" ? null : structureType,
                  spreadRatio,
                  lateDistanceAtr: 0,
                },
                rulebook,
              );
              const grade = gradeForScore(score, rulebook);
              if (grade) reached.add(grade);
            }
          }
        }
      }
    }
  }
  return reached;
}

/** Families x grades that cannot be reached under this rulebook. */
export function deadBands(rulebook: Rulebook): Array<{ family: SetupType; grade: Grade }> {
  const dead: Array<{ family: SetupType; grade: Grade }> = [];
  for (const family of Object.keys(SCORECARDS) as SetupType[]) {
    const reached = reachableGrades(family, rulebook);
    for (const grade of TIER_ORDER) {
      if (!reached.has(grade)) dead.push({ family, grade });
    }
  }
  return dead;
}
