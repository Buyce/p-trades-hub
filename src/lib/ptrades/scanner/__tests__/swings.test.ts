import { describe, expect, it } from "vitest";
import { lastSwing, swingHighs, swingLows } from "../swings.server";
import { candle } from "./fixtures";

/**
 * Spec: mark_swings uses a centred window, so a pivot is only a swing once it
 * has been confirmed by candles on BOTH sides. Unconfirmed edge pivots are
 * never swings — that is what stops the scanner reading the future.
 */

function bars(rows: Array<[high: number, low: number]>) {
  return rows.map(([high, low], i) =>
    candle(i, { open: (high + low) / 2, high, low, close: (high + low) / 2 }),
  );
}

describe("swingHighs", () => {
  it("finds a confirmed centre pivot", () => {
    const candles = bars([
      [10, 8],
      [11, 9],
      [15, 12],
      [11, 9],
      [10, 8],
    ]);
    const highs = swingHighs(candles, 2);
    expect(highs).toHaveLength(1);
    expect(highs[0]).toMatchObject({ index: 2, price: 15 });
  });

  it("ignores an unconfirmed pivot at the end of the series", () => {
    const candles = bars([
      [10, 8],
      [11, 9],
      [12, 10],
      [13, 11],
      [20, 15],
    ]);
    expect(swingHighs(candles, 2)).toEqual([]);
  });

  it("ignores an unconfirmed pivot at the start of the series", () => {
    const candles = bars([
      [20, 15],
      [11, 9],
      [10, 8],
      [11, 9],
      [10, 8],
    ]);
    expect(swingHighs(candles, 2)).toEqual([]);
  });

  it("rejects equal highs, because a tie is not a pivot", () => {
    const candles = bars([
      [10, 8],
      [15, 12],
      [15, 12],
      [11, 9],
      [10, 8],
    ]);
    expect(swingHighs(candles, 2)).toEqual([]);
  });

  it("returns swings in ascending index order", () => {
    const candles = bars([
      [10, 8],
      [9, 7],
      [15, 12],
      [9, 7],
      [8, 6],
      [9, 7],
      [18, 14],
      [9, 7],
      [8, 6],
    ]);
    const highs = swingHighs(candles, 2);
    expect(highs.map((s) => s.index)).toEqual([2, 6]);
  });

  it("returns nothing when the series is shorter than the window", () => {
    expect(swingHighs(bars([[10, 8]]), 2)).toEqual([]);
  });
});

describe("swingLows", () => {
  it("finds a confirmed centre trough", () => {
    const candles = bars([
      [10, 8],
      [9, 7],
      [8, 3],
      [9, 7],
      [10, 8],
    ]);
    const lows = swingLows(candles, 2);
    expect(lows).toHaveLength(1);
    expect(lows[0]).toMatchObject({ index: 2, price: 3 });
  });

  it("rejects equal lows", () => {
    const candles = bars([
      [10, 8],
      [9, 3],
      [9, 3],
      [10, 8],
      [11, 9],
    ]);
    expect(swingLows(candles, 2)).toEqual([]);
  });
});

describe("lastSwing", () => {
  it("returns the most recent swing, or null when there is none", () => {
    const candles = bars([
      [10, 8],
      [9, 7],
      [15, 12],
      [9, 7],
      [8, 6],
      [9, 7],
      [18, 14],
      [9, 7],
      [8, 6],
    ]);
    expect(lastSwing(swingHighs(candles, 2))!.index).toBe(6);
    expect(lastSwing([])).toBeNull();
  });
});
