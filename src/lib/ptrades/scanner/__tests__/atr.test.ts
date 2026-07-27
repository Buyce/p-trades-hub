import { describe, expect, it } from "vitest";
import { atr, trueRange } from "../atr.server";
import { candle, fromCloses } from "./fixtures";

/**
 * Spec: true_range(frame) uses the three standard components and atr(frame)
 * smooths them. Index 0 has no previous close and is excluded.
 */

const gapSeries = [
  candle(0, { open: 10, high: 11, low: 9, close: 10 }),
  // Gap up: high - prevClose (2.0) dominates the plain range (1.0).
  candle(1, { open: 11.5, high: 12, low: 11, close: 11.5 }),
  // Gap down: prevClose - low (4.5) dominates.
  candle(2, { open: 7.5, high: 8, low: 7, close: 7.5 }),
];

describe("trueRange", () => {
  it("excludes the first candle, which has no previous close", () => {
    expect(trueRange(gapSeries)).toHaveLength(gapSeries.length - 1);
  });

  it("uses the largest of the three components", () => {
    expect(trueRange(gapSeries)).toEqual([2, 4.5]);
  });

  it("falls back to the plain high-low range when there is no gap", () => {
    const flatish = [
      candle(0, { open: 10, high: 10.5, low: 9.5, close: 10 }),
      candle(1, { open: 10, high: 10.4, low: 9.6, close: 10 }),
    ];
    expect(trueRange(flatish)).toEqual([0.8000000000000007]);
  });

  it("returns an empty list for a single candle", () => {
    expect(trueRange([gapSeries[0]])).toEqual([]);
  });
});

describe("atr", () => {
  it("seeds with the simple mean of the first `period` true ranges", () => {
    // trueRange = [2, 4.5]; period 2 leaves no candles to smooth.
    expect(atr(gapSeries, 2)).toBeCloseTo(3.25, 10);
  });

  it("smooths subsequent bars Wilder-style", () => {
    const closes = [10, 11, 12, 13, 14, 15];
    const series = fromCloses(closes, 1);
    const trs = trueRange(series);
    const seed = (trs[0] + trs[1]) / 2;
    let expected = seed;
    for (let i = 2; i < trs.length; i += 1) {
      expected = (expected * 1 + trs[i]) / 2;
    }
    expect(atr(series, 2)).toBeCloseTo(expected, 10);
  });

  it("returns null when there are fewer than period + 1 candles", () => {
    expect(atr(gapSeries, 14)).toBeNull();
    expect(atr(gapSeries, 3)).toBeNull();
    expect(atr(gapSeries, 2)).not.toBeNull();
  });

  it("returns null when the series produces a non-finite value", () => {
    const broken = [
      candle(0, { open: 10, high: 11, low: 9, close: 10 }),
      candle(1, { open: 10, high: Number.NaN, low: 9, close: 10 }),
      candle(2, { open: 10, high: 11, low: 9, close: 10 }),
    ];
    expect(atr(broken, 2)).toBeNull();
  });

  it("is deterministic", () => {
    const series = fromCloses([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(atr(series, 3)).toBe(atr(series, 3));
  });
});
