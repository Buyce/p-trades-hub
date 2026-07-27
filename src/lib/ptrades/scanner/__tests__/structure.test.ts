import { describe, expect, it } from "vitest";
import { detectSweep } from "../sweep.server";
import { detectDisplacement } from "../displacement.server";
import { candle } from "./fixtures";

/**
 * Spec: latest_liquidity_sweep finds a prior confirmed swing that price traded
 * through and then closed back inside. A wick that stays outside is a break,
 * not a sweep. latest_displacement finds a directional candle whose body is at
 * least ATR x the configured multiple.
 */

function bars(rows: Array<[high: number, low: number, close?: number]>) {
  return rows.map(([high, low, close], i) =>
    candle(i, {
      open: (high + low) / 2,
      high,
      low,
      close: close ?? (high + low) / 2,
    }),
  );
}

// Index 2 is a confirmed swing low at 95. Index 8 trades to 94 and closes at 97.
const longSweep = bars([
  [101, 100],
  [100, 99],
  [96, 95],
  [100, 99],
  [101, 100],
  [102, 101],
  [103, 102],
  [102, 101],
  [95, 94, 97],
  [100, 99],
]);

describe("detectSweep", () => {
  it("reports LONG when a prior swing low is taken and reclaimed", () => {
    const result = detectSweep(longSweep, 2, 6);
    expect(result).toMatchObject({
      found: true,
      direction: "LONG",
      level: 95,
      extreme: 94,
    });
    expect(result.sweptAt).toBe(longSweep[8].time);
  });

  it("reports SHORT when a prior swing high is taken and rejected", () => {
    // Mirror the long fixture around 200 so highs become lows.
    const mirrored = longSweep.map((c, i) =>
      candle(i, {
        open: 200 - c.open,
        high: 200 - c.low,
        low: 200 - c.high,
        close: 200 - c.close,
      }),
    );
    const result = detectSweep(mirrored, 2, 6);
    expect(result).toMatchObject({ found: true, direction: "SHORT", level: 105, extreme: 106 });
  });

  it("does not fire when price closes beyond the level instead of back inside", () => {
    const broken = [...longSweep];
    // Same 94 low, but the candle closes at 94.5 — below the swept level.
    broken[8] = candle(8, { open: 96, high: 96, low: 94, close: 94.5 });
    expect(detectSweep(broken, 2, 6).found).toBe(false);
  });

  it("does not fire when price never trades through the level", () => {
    const untouched = [...longSweep];
    untouched[8] = candle(8, { open: 99, high: 100, low: 98, close: 99 });
    expect(detectSweep(untouched, 2, 6).found).toBe(false);
  });

  it("ignores swings that are not strictly prior to the sweeping candle", () => {
    // A swing formed on the sweeping candle itself must never be its own level.
    const result = detectSweep(longSweep, 2, 6);
    expect(result.level).toBe(95);
    expect(result.sweptAt).not.toBe(longSweep[2].time);
  });

  it("returns not-found for a series shorter than the confirmation window", () => {
    expect(detectSweep(longSweep.slice(0, 4), 2, 6).found).toBe(false);
  });
});

describe("detectDisplacement", () => {
  const atrValue = 1;

  it("qualifies a directional body at or above the ATR multiple", () => {
    const candles = bars([[10, 9]]).concat(
      candle(1, { open: 100, high: 102, low: 99.5, close: 101.5 }),
    );
    const result = detectDisplacement(candles, "LONG", atrValue, 1, 2);
    expect(result.found).toBe(true);
    expect(result.bodyAtr).toBeCloseTo(1.5, 10);
  });

  it("rejects a body below the ATR multiple", () => {
    const candles = [candle(0, { open: 100, high: 101, low: 99, close: 100.5 })];
    expect(detectDisplacement(candles, "LONG", atrValue, 1, 2).found).toBe(false);
  });

  it("never counts a candle closing against the setup direction", () => {
    const candles = [candle(0, { open: 100, high: 100.5, low: 96, close: 97 })];
    expect(detectDisplacement(candles, "LONG", atrValue, 1, 2)).toMatchObject({
      found: false,
      bodyAtr: null,
    });
  });

  it("returns not-found when ATR is unavailable", () => {
    const candles = [candle(0, { open: 100, high: 105, low: 99, close: 104 })];
    expect(detectDisplacement(candles, "LONG", null, 1, 2).found).toBe(false);
    expect(detectDisplacement(candles, "LONG", 0, 1, 2).found).toBe(false);
  });

  it("returns not-found for an empty series", () => {
    expect(detectDisplacement([], "LONG", atrValue, 1, 2).found).toBe(false);
  });
});
