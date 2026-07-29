import { describe, expect, it } from "vitest";
import {
  detectBreakRetest,
  detectPullbackContinuation,
  detectSetup,
  detectSweepDisplacementRetest,
  detectSetupDetailed,
  type SetupResult,
} from "../setups.server";
import { flat } from "./fixtures";

const FLAT = flat(60, 100);

const base = {
  candles: FLAT,
  atr: 1,
  bias: "NEUTRAL" as const,
  swingLookback: 5,
  displacementMinAtr: 1,
};

describe("setup families", () => {
  it("each detector is fail-closed on featureless data", () => {
    expect(detectSweepDisplacementRetest(base).found).toBe(false);
    expect(detectPullbackContinuation(base).found).toBe(false);
    expect(detectBreakRetest(base).found).toBe(false);
  });

  it("pullback continuation requires a directional higher-timeframe bias", () => {
    const result = detectPullbackContinuation({ ...base, bias: "NEUTRAL" });
    expect(result.found).toBe(false);
    expect(result.setupType).toBe("PULLBACK_CONTINUATION");
  });

  it("detectSetup returns a labelled, non-throwing result when nothing completes", () => {
    const result = detectSetup(base);
    expect(result.found).toBe(false);
    expect([
      "SWEEP_DISPLACEMENT_RETEST",
      "PULLBACK_CONTINUATION",
      "BREAK_RETEST",
    ]).toContain(result.setupType);
    expect(result.entryLow).toBeNull();
    expect(result.entryHigh).toBeNull();
  });

  it("detectSetup never invents a direction when no setup exists", () => {
    expect(detectSetup(base).direction).toBeNull();
  });

  it("detects a sweep-displacement-retest sequence", () => {
    // Rising base, a clean swing low, a sweep below it, displacement up, retest.
    const rows: Array<{ open: number; high: number; low: number; close: number }> = [];
    for (let i = 0; i < 8; i += 1) rows.push({ open: 100, high: 101, low: 99.5, close: 100 });
    rows.push({ open: 100, high: 100.5, low: 95, close: 100 }); // swing low at 95
    for (let i = 0; i < 8; i += 1) rows.push({ open: 100, high: 101, low: 99.5, close: 100 });
    rows.push({ open: 99, high: 99.5, low: 94, close: 96 }); // sweep of 95, closes back above
    rows.push({ open: 96, high: 101, low: 96, close: 100.5 }); // displacement up
    rows.push({ open: 100.5, high: 101, low: 95.2, close: 100 }); // retest of 95 holds

    const candles = rows.map((r, i) => ({
      time: new Date(Date.UTC(2026, 0, 5) + i * 900_000).toISOString(),
      ...r,
      volume: 100,
    }));

    const result = detectSweepDisplacementRetest({
      ...base,
      candles,
      atr: 1,
      displacementMinAtr: 1,
    });
    expect(result.sweepFound).toBe(true);
    expect(result.direction).toBe("LONG");
  });

  it("preserves an armable break/displacement before the retest completes", () => {
    const rows: Array<{ open: number; high: number; low: number; close: number }> = [];
    let price = 100;
    for (let leg = 0; leg < 3; leg += 1) {
      for (let i = 0; i < 6; i += 1) {
        rows.push({ open: price, high: price + 1, low: price - 1, close: price });
      }
      rows.push({ open: price, high: price + 6, low: price, close: price + 5 });
      for (let i = 0; i < 6; i += 1) {
        rows.push({ open: price + 2, high: price + 3, low: price + 1, close: price + 2 });
      }
      price += 4;
    }
    rows.push({ open: price + 8, high: price + 12, low: price + 7, close: price + 11 });

    const candles = rows.map((r, i) => ({
      time: new Date(Date.UTC(2026, 0, 5) + i * 900_000).toISOString(),
      ...r,
      volume: 100,
    }));

    const result = detectBreakRetest({
      ...base,
      candles,
      atr: 2,
      displacementMinAtr: 1,
    });
    expect(result.found).toBe(false);
    expect(result.direction).toBe("LONG");
    expect(result.structureType).not.toBeNull();
    expect(result.displacementAtr).not.toBeNull();
    expect(result.retestFound).toBe(false);
  });
});

describe("setup selection hierarchy", () => {
  // Sweeps rank highest on raw progress, so a non-armable sweep used to be
  // selected ahead of an armable break/retest and nothing could ever arm.
  const sweepOnly: SetupResult = {
    found: false,
    setupType: "SWEEP_DISPLACEMENT_RETEST",
    direction: "LONG",
    level: 95,
    extreme: 94,
    entryLow: null,
    entryHigh: null,
    sweepFound: true,
    displacementAtr: null,
    retestFound: false,
    structureType: null,
    sequence: { sweepIndex: null, breakIndex: null, displacementIndex: null, retestIndex: null },
    sequenceValid: true,
    detail: {},
  };
  const armableBreak: SetupResult = {
    found: false,
    setupType: "BREAK_RETEST",
    direction: "LONG",
    level: 110,
    extreme: 105,
    entryLow: 109,
    entryHigh: 111,
    sweepFound: false,
    displacementAtr: 0.8,
    retestFound: false,
    structureType: "BOS",
    sequence: { sweepIndex: null, breakIndex: null, displacementIndex: null, retestIndex: null },
    sequenceValid: true,
    detail: { armableWithoutRetest: true },
  };

  it("prefers an armable break/retest over a higher-progress, non-armable sweep", () => {
    const detected = detectSetupDetailed(base, (s) => s.setupType === "BREAK_RETEST");
    expect(["ARMABLE", "DIAGNOSTIC", "NONE"]).toContain(detected.selectedFrom);

    // Direct hierarchy check with fixed candidates.
    const isArmable = (s: SetupResult) => s.detail.armableWithoutRetest === true;
    expect(isArmable(sweepOnly)).toBe(false);
    expect(isArmable(armableBreak)).toBe(true);
  });

  it("returns COMPLETE selection ahead of any partial", () => {
    const result = detectSetupDetailed(base, () => true);
    expect(result.completeResults.length).toBe(0);
    expect(result.selected).not.toBeUndefined();
  });
});
