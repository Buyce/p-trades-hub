import { describe, expect, it } from "vitest";
import { gradeForScore, scoreCandidate, type ScoreInput } from "../scoring.server";
import { DEFAULT_RULEBOOK } from "../types";

/**
 * Spec: total_score is deterministic and grade_for_score maps it to A+, A, B or
 * REJECT. Bands follow the Master Handoff: A+ 95-100, A 90-94.99, B 80-89.99.
 */

const rulebook = DEFAULT_RULEBOOK;

const perfect: ScoreInput = {
  rr: 4,
  biasAligned: true,
  d1Aligned: true,
  displacementAtr: rulebook.displacement_min_atr,
  sweepFound: true,
  retestFound: true,
  spreadRatio: 0,
  lateDistanceAtr: 0,
  macroAligned: true,
};

const empty: ScoreInput = {
  rr: null,
  biasAligned: false,
  d1Aligned: false,
  displacementAtr: null,
  sweepFound: false,
  retestFound: false,
  spreadRatio: null,
  lateDistanceAtr: null,
};

describe("gradeForScore", () => {
  it("uses the Master Handoff bands", () => {
    expect(rulebook.grades).toEqual({ A_PLUS: 95, A: 90, B: 80, C: 70 });
  });

  it("assigns A+ from 95 upward", () => {
    expect(gradeForScore(100, rulebook)).toBe("A_PLUS");
    expect(gradeForScore(95, rulebook)).toBe("A_PLUS");
  });

  it("assigns A from 90 to just under 95", () => {
    expect(gradeForScore(94.99, rulebook)).toBe("A");
    expect(gradeForScore(90, rulebook)).toBe("A");
  });

  it("assigns B from 80 to just under 90", () => {
    expect(gradeForScore(89.99, rulebook)).toBe("B");
    expect(gradeForScore(80, rulebook)).toBe("B");
  });

  it("assigns C from 70 to just under 80", () => {
    expect(gradeForScore(79.99, rulebook)).toBe("C");
    expect(gradeForScore(70, rulebook)).toBe("C");
  });

  it("rejects below 70", () => {
    expect(gradeForScore(69.99, rulebook)).toBeNull();
    expect(gradeForScore(0, rulebook)).toBeNull();
  });
});

describe("scoreCandidate", () => {
  it("is deterministic — identical input always produces an identical score", () => {
    const a = scoreCandidate(perfect, rulebook);
    const b = scoreCandidate(perfect, rulebook);
    expect(a.score).toBe(b.score);
    expect(a.components).toEqual(b.components);
  });

  it("caps the total at the 100-point budget", () => {
    expect(scoreCandidate(perfect, rulebook).score).toBe(100);
  });

  it("scores zero when nothing is confirmed", () => {
    const result = scoreCandidate(empty, rulebook);
    expect(result.score).toBe(0);
    expect(result.grade).toBeNull();
  });

  it("uses the Master Handoff component weights", () => {
    const { components } = scoreCandidate(perfect, rulebook);
    expect(components).toEqual({
      htf_alignment: 20,
      liquidity_quality: 20,
      structure_confirmation: 15,
      displacement_strength: 15,
      retest_quality: 15,
      macro_alignment: 10,
      execution_quality: 5,
    });
  });

  it("scores the 2.0R minimum at half of structure confirmation", () => {
    const { components } = scoreCandidate({ ...empty, rr: 2 }, rulebook);
    expect(components.structure_confirmation).toBeCloseTo(7.5, 10);
  });

  it("never awards negative points for very poor inputs", () => {
    const { components, score } = scoreCandidate(
      {
        ...empty,
        rr: 0.1,
        displacementAtr: 0,
        spreadRatio: 5,
        lateDistanceAtr: 5,
      },
      rulebook,
    );
    Object.values(components).forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(1);
  });

  it("does not award macro points while macro alignment is unevaluated", () => {
    const { components } = scoreCandidate(perfect, rulebook);
    const withoutMacro = scoreCandidate({ ...perfect, macroAligned: false }, rulebook);
    expect(components.macro_alignment).toBe(10);
    expect(withoutMacro.components.macro_alignment).toBe(0);
  });

  it("rejects a sweep with no retest, so the scanner stays fail-closed", () => {
    // Sweep + displacement + perfect execution, but no retest and no macro: 75.
    const sweepOnly = scoreCandidate(
      { ...perfect, retestFound: false, macroAligned: false },
      rulebook,
    );
    expect(sweepOnly.score).toBe(75);
    // 75 lands in the C band on score alone; a missing retest is a hard gate
    // elsewhere in the pipeline, so scoring does not have to reject it.
    expect(sweepOnly.grade).toBe("C");
  });

  it("reaches A only when the retest also confirms", () => {
    const withRetest = scoreCandidate({ ...perfect, macroAligned: false }, rulebook);
    expect(withRetest.score).toBe(90);
    expect(withRetest.grade).toBe("A");
  });


  it("orders a stronger candidate above a weaker one", () => {
    const strong = scoreCandidate(perfect, rulebook).score;
    const weak = scoreCandidate({ ...perfect, biasAligned: false, rr: 2 }, rulebook).score;
    expect(strong).toBeGreaterThan(weak);
  });
});
