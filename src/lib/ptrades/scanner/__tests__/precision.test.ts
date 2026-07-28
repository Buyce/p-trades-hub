import { describe, expect, it } from "vitest";
import {
  buildExecutionZone,
  calculateAdaptiveZoneWidthPoints,
} from "../entry-zone.server";
import { buildInvalidation, hasInvalidation, isInvalidated } from "../invalidation.server";
import { canTransition, isAlertable, transition } from "../lifecycle.server";
import { detectMicroTrigger } from "../micro-trigger.server";
import type { Candle } from "../types";

const POINT = 0.00001;

const widthInput = {
  spreadPoints: 1,
  atrM1: 0,
  atrM5: 0,
  point: POINT,
  minimumWidthPoints: 4,
  maximumWidthPoints: 10,
  spreadMultiplier: 2,
  atrM1Multiplier: 0.05,
  atrM5Multiplier: 0.02,
};

describe("execution zone", () => {
  it("never falls below the instrument floor or above its ceiling", () => {
    expect(calculateAdaptiveZoneWidthPoints(widthInput)).toBe(4);
    expect(
      calculateAdaptiveZoneWidthPoints({ ...widthInput, spreadPoints: 50 }),
    ).toBe(10);
  });

  it("absorbs the spread when the spread is the binding constraint", () => {
    expect(calculateAdaptiveZoneWidthPoints({ ...widthInput, spreadPoints: 3 })).toBe(6);
  });

  it("tracks the calmer of the two volatility readings, never the louder", () => {
    const calm = calculateAdaptiveZoneWidthPoints({
      ...widthInput,
      atrM1: POINT * 100, // 100 points -> 5
      atrM5: POINT * 400, // 400 points -> 8
    });
    expect(calm).toBe(5);
  });

  it("is asymmetric: a long is never told to buy above its anchor", () => {
    const long = buildExecutionZone({
      preferredEntry: 1.1,
      direction: "LONG",
      zoneWidthPoints: 5,
      point: POINT,
    });
    expect(long.entryHigh).toBe(1.1);
    expect(long.entryLow).toBeCloseTo(1.1 - 5 * POINT, 10);

    const short = buildExecutionZone({
      preferredEntry: 1.1,
      direction: "SHORT",
      zoneWidthPoints: 5,
      point: POINT,
    });
    expect(short.entryLow).toBe(1.1);
    expect(short.entryHigh).toBeCloseTo(1.1 + 5 * POINT, 10);
  });

  it("produces a materially tighter zone than a raw ATR band", () => {
    const zone = buildExecutionZone({
      preferredEntry: 2000,
      direction: "LONG",
      zoneWidthPoints: 40,
      point: 0.01,
    });
    expect(zone.entryHigh - zone.entryLow).toBeCloseTo(0.4, 10);
  });
});

describe("invalidation", () => {
  it("is present whenever the setup has a structural extreme", () => {
    const result = buildInvalidation({
      direction: "LONG",
      extreme: 1.23456,
      level: 1.24,
      timeframe: "M15",
      digits: 5,
    });
    expect(hasInvalidation(result)).toBe(true);
    expect(result.condition).toContain("1.23456");
  });

  it("is absent — never invented — when no structure is available", () => {
    const result = buildInvalidation({
      direction: "SHORT",
      extreme: null,
      level: null,
      timeframe: "M15",
      digits: 5,
    });
    expect(hasInvalidation(result)).toBe(false);
    expect(result.price).toBeNull();
  });

  it("fires only on acceptance beyond the level", () => {
    expect(isInvalidated("LONG", 1.1, 1.09)).toBe(true);
    expect(isInvalidated("LONG", 1.1, 1.11)).toBe(false);
    expect(isInvalidated("SHORT", 1.1, 1.11)).toBe(true);
  });
});

describe("lifecycle", () => {
  it("only ENTRY_READY may alert", () => {
    expect(isAlertable("ENTRY_READY")).toBe(true);
    for (const state of ["DETECTED", "ARMED", "MICRO_TRIGGERED", "MISSED"] as const) {
      expect(isAlertable(state)).toBe(false);
    }
  });

  it("cannot skip the trigger on the way to ENTRY_READY", () => {
    expect(canTransition("ARMED", "ENTRY_READY")).toBe(false);
    expect(canTransition("MICRO_TRIGGERED", "ENTRY_READY")).toBe(true);
    expect(() => transition("ARMED", "ENTRY_READY")).toThrow();
  });

  it("treats terminal states as terminal", () => {
    expect(canTransition("EXPIRED", "ARMED")).toBe(false);
    expect(canTransition("INVALIDATED", "ENTRY_READY")).toBe(false);
  });
});

/** Builds a long micro sequence: rejection, displacement, BOS, held retest. */
function longSequence(): Candle[] {
  const candles: Candle[] = [];
  let t = Date.parse("2026-07-28T08:00:00Z");
  const push = (open: number, high: number, low: number, close: number) => {
    candles.push({ time: new Date(t).toISOString(), open, high, low, close, volume: 1 });
    t += 60_000;
  };
  // A wavy base so the micro swing detector has real pivots to protect.
  const base = [
    [1.1, 1.1008, 1.0996, 1.1002],
    [1.1002, 1.1012, 1.1, 1.1006],
    [1.1006, 1.1004, 1.0994, 1.0998],
    [1.0998, 1.1006, 1.0992, 1.1],
    [1.1, 1.1014, 1.0998, 1.1008],
    [1.1008, 1.1005, 1.0993, 1.0996],
    [1.0996, 1.1003, 1.0991, 1.1],
    [1.1, 1.101, 1.0997, 1.1004],
    [1.1004, 1.1002, 1.099, 1.0995],
    [1.0995, 1.1001, 1.0989, 1.0998],
  ];
  for (const [o, h, l, c] of base) push(o, h, l, c);
  push(1.1, 1.1005, 1.0985, 1.1002); // rejection wick into the zone
  push(1.1002, 1.1035, 1.1002, 1.1032); // displacement
  push(1.1032, 1.1045, 1.103, 1.1042); // closes beyond the protected swing (BOS)
  push(1.1042, 1.1043, 1.1012, 1.1035); // retest of the broken level, held
  return candles;
}

describe("micro trigger", () => {
  const base = { zoneLow: 1.098, zoneHigh: 1.1005, atrM1: 0.0015, direction: "LONG" as const };

  it("confirms only when the full sequence completes in order", () => {
    const result = detectMicroTrigger({ candles: longSequence(), ...base });
    expect(result.triggered).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.retestCandleTime).not.toBeNull();
  });

  it("stays unconfirmed when the retest never arrives", () => {
    const candles = longSequence().slice(0, -1);
    const result = detectMicroTrigger({ candles, ...base });
    expect(result.triggered).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.failures.join(" ")).toContain("retested");
  });

  it("fails closed without a rejection at the armed area", () => {
    const result = detectMicroTrigger({
      candles: longSequence(),
      ...base,
      zoneLow: 1.2,
      zoneHigh: 1.21,
    });
    expect(result.confirmed).toBe(false);
    expect(result.triggered).toBe(false);
  });

  it("fails closed when the M1 ATR is unavailable", () => {
    const result = detectMicroTrigger({ candles: longSequence(), ...base, atrM1: null });
    expect(result.confirmed).toBe(false);
    expect(result.failures[0]).toContain("ATR");
  });
});
