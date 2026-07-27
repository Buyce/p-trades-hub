import { describe, expect, it } from "vitest";
import { rewardToRisk, risk, targetsFrom } from "../risk.server";
import { checkLateEntry } from "../late-entry.server";
import { fingerprint } from "../fingerprint.server";

/**
 * Spec: CandidateSetup.risk, reward_to_risk(target), and the 2R/3R target
 * ladder. Plus late-entry distance and duplicate fingerprinting.
 */

describe("risk", () => {
  it("is the absolute distance between entry and stop", () => {
    expect(risk(100, 95)).toBe(5);
    expect(risk(95, 100)).toBe(5);
  });

  it("is null when risk is zero or undefined", () => {
    expect(risk(100, 100)).toBeNull();
    expect(risk(null, 95)).toBeNull();
    expect(risk(100, null)).toBeNull();
    expect(risk(Number.NaN, 95)).toBeNull();
  });
});

describe("rewardToRisk", () => {
  it("returns 2.0 for a long target two risk units above entry", () => {
    expect(rewardToRisk(100, 95, 110)).toBeCloseTo(2, 10);
  });

  it("returns 3.0 for a long target three risk units above entry", () => {
    expect(rewardToRisk(100, 95, 115)).toBeCloseTo(3, 10);
  });

  it("returns 2.0 for a short target two risk units below entry", () => {
    expect(rewardToRisk(100, 105, 90)).toBeCloseTo(2, 10);
  });

  it("returns null when the target sits on the wrong side of entry", () => {
    expect(rewardToRisk(100, 95, 90)).toBeNull();
    expect(rewardToRisk(100, 105, 110)).toBeNull();
  });

  it("returns null when the target equals the entry", () => {
    expect(rewardToRisk(100, 95, 100)).toBeNull();
  });

  it("returns null when risk is undefined", () => {
    expect(rewardToRisk(100, 100, 110)).toBeNull();
    expect(rewardToRisk(null, 95, 110)).toBeNull();
    expect(rewardToRisk(100, 95, null)).toBeNull();
  });
});

describe("targetsFrom", () => {
  it("builds the 2R and 3R ladder above entry for a long", () => {
    expect(targetsFrom(100, 95, "LONG")).toEqual([110, 115]);
  });

  it("builds the 2R and 3R ladder below entry for a short", () => {
    expect(targetsFrom(100, 105, "SHORT")).toEqual([90, 85]);
  });

  it("honours custom multiples", () => {
    expect(targetsFrom(100, 95, "LONG", [2, 3, 4])).toEqual([110, 115, 120]);
  });

  it("returns nothing when risk is zero", () => {
    expect(targetsFrom(100, 100, "LONG")).toEqual([]);
  });

  it("produces targets whose R:R matches the multiples used", () => {
    const [tp1, tp2] = targetsFrom(100, 95, "LONG");
    expect(rewardToRisk(100, 95, tp1)).toBeCloseTo(2, 10);
    expect(rewardToRisk(100, 95, tp2)).toBeCloseTo(3, 10);
  });
});

describe("checkLateEntry", () => {
  it("is not late while price sits inside the entry zone", () => {
    expect(checkLateEntry(100, 99, 101, 2, 0.5)).toMatchObject({ late: false, distanceAtr: 0 });
  });

  it("measures distance beyond the zone in ATR", () => {
    const result = checkLateEntry(103, 99, 101, 2, 0.5);
    expect(result.distanceAtr).toBeCloseTo(1, 10);
    expect(result.late).toBe(true);
  });

  it("measures distance below the zone for a short setup", () => {
    const result = checkLateEntry(97, 99, 101, 2, 0.5);
    expect(result.distanceAtr).toBeCloseTo(1, 10);
    expect(result.late).toBe(true);
  });

  it("is not late exactly at the threshold", () => {
    expect(checkLateEntry(102, 99, 101, 2, 0.5).late).toBe(false);
  });

  it("reports no distance when inputs are missing", () => {
    expect(checkLateEntry(null, 99, 101, 2)).toMatchObject({ late: false, distanceAtr: null });
    expect(checkLateEntry(100, 99, 101, null)).toMatchObject({ late: false, distanceAtr: null });
  });
});

describe("fingerprint", () => {
  const base = {
    instrument: "XAUUSD",
    direction: "LONG",
    setupType: "SWEEP_DISPLACEMENT_RETEST",
    timeframe: "M15",
    tradingDayUtc: "2026-01-05",
    entry: 2000,
    stop: 1990,
    atr: 4,
  };

  it("is stable for identical input", () => {
    expect(fingerprint(base)).toBe(fingerprint(base));
  });

  it("treats near-identical geometry as the same idea", () => {
    // Rounding step is ATR x 0.25 = 1.0, so a 0.2 drift collapses to one idea.
    expect(fingerprint({ ...base, entry: 2000.2 })).toBe(fingerprint(base));
  });

  it("separates a genuinely different price level", () => {
    expect(fingerprint({ ...base, entry: 2010 })).not.toBe(fingerprint(base));
  });

  it("separates a different direction, day, instrument or setup", () => {
    expect(fingerprint({ ...base, direction: "SHORT" })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, tradingDayUtc: "2026-01-06" })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, instrument: "EURUSD" })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, setupType: "BREAKOUT_RETEST" })).not.toBe(fingerprint(base));
  });

  it("handles missing prices without throwing", () => {
    expect(fingerprint({ ...base, entry: null, stop: null })).toHaveLength(32);
  });
});
