import { describe, expect, it } from "vitest";
import { reachableScoreRange, tierReachability } from "../reachability";
import { structuralTargets } from "../risk.server";
import { rewardToRisk } from "../risk.server";
import { DEFAULT_RULEBOOK } from "../types";
import type { Rulebook } from "../types";

/**
 * Governance: every tier band must be produceable by a candidate that passes
 * every hard gate. A band outside the reachable window is a silent dead tier.
 */

describe("reachableScoreRange", () => {
  it("reports a window a gate-passing candidate can actually land in", () => {
    const { min, max } = reachableScoreRange(DEFAULT_RULEBOOK);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThan(min);
    expect(max).toBeLessThanOrEqual(100);
  });
});

describe("tierReachability", () => {
  it("flags a C band that sits below the gate-passing floor", () => {
    const { min } = reachableScoreRange(DEFAULT_RULEBOOK);
    const book: Rulebook = {
      ...DEFAULT_RULEBOOK,
      grades: { ...DEFAULT_RULEBOOK.grades, C: Math.max(0, min - 10) },
    };
    const report = tierReachability(book);
    expect(report.hasDeadBand).toBe(true);
    expect(report.tiers.find((t) => t.tier === "C")?.reachable).toBe(false);
  });

  it("flags an A+ band above the highest attainable score", () => {
    const book: Rulebook = {
      ...DEFAULT_RULEBOOK,
      grades: { ...DEFAULT_RULEBOOK.grades, A_PLUS: 100.5 },
    };
    const report = tierReachability(book);
    expect(report.tiers.find((t) => t.tier === "A_PLUS")?.reachable).toBe(false);
  });

  it("accepts bands placed inside the reachable window", () => {
    const { min, max } = reachableScoreRange(DEFAULT_RULEBOOK);
    const span = max - min;
    const book: Rulebook = {
      ...DEFAULT_RULEBOOK,
      grades: {
        C: min,
        B: min + span * 0.25,
        A: min + span * 0.55,
        A_PLUS: min + span * 0.8,
      },
    };
    expect(tierReachability(book).hasDeadBand).toBe(false);
  });
});

describe("structuralTargets", () => {
  const base = { entry: 100, stop: 95, direction: "LONG" as const, atr: 2 };

  it("uses the nearest opposing levels ahead of entry", () => {
    const out = structuralTargets({ ...base, levels: [108, 113, 122, 90] });
    expect(out).toEqual([108, 113, 122]);
  });

  it("skips levels that do not clear the minimum reward-to-risk", () => {
    const out = structuralTargets({ ...base, levels: [102, 108, 113], minRr: 1.2 });
    expect(out[0]).toBe(108);
  });

  it("collapses levels describing the same liquidity pocket", () => {
    const out = structuralTargets({ ...base, levels: [108, 108.4, 113] });
    expect(out).toEqual([108, 113, 115]);
  });

  it("ignores levels beyond the realistic ceiling", () => {
    const out = structuralTargets({ ...base, levels: [200], maxRr: 6 });
    expect(out).toEqual([110, 115, 120]);
  });

  it("falls back to the R-multiple ladder when structure is absent", () => {
    expect(structuralTargets({ ...base, levels: [] })).toEqual([110, 115, 120]);
  });

  it("mirrors for shorts", () => {
    const out = structuralTargets({
      entry: 100,
      stop: 105,
      direction: "SHORT",
      atr: 2,
      levels: [92, 87, 110],
    });
    expect(out).toEqual([92, 87, 85]);
  });

  it("produces a varying reward-to-risk instead of a fixed 2R", () => {
    const rrs = [
      structuralTargets({ ...base, levels: [107] }),
      structuralTargets({ ...base, levels: [118] }),
    ].map(([tp1]) => rewardToRisk(100, 95, tp1));
    expect(rrs[0]).toBeCloseTo(1.4, 10);
    expect(rrs[1]).toBeCloseTo(3.6, 10);
  });

  it("returns nothing when risk is undefined", () => {
    expect(structuralTargets({ ...base, stop: 100, levels: [110] })).toEqual([]);
  });
});
