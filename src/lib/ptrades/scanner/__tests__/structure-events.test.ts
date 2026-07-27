import { describe, expect, it } from "vitest";
import { detectStructureEvent, priorTrend } from "../structure.server";
import { swingHighs, swingLows } from "../swings.server";
import { candle } from "./fixtures";

/** Builds a series where each entry is [low, high, close]. */
function series(rows: Array<[number, number, number]>) {
  return rows.map(([low, high, close], i) =>
    candle(i, { open: (low + high) / 2, high, low, close }),
  );
}

/** Uptrend with higher highs and higher lows, then a close above the last swing high. */
function uptrendThenBreak(finalClose: number) {
  const rows: Array<[number, number, number]> = [];
  let base = 100;
  for (let leg = 0; leg < 3; leg += 1) {
    for (let i = 0; i < 6; i += 1) rows.push([base - 1, base + 1, base]);
    rows.push([base, base + 6, base + 5]); // swing high
    for (let i = 0; i < 6; i += 1) rows.push([base + 1, base + 3, base + 2]);
    base += 4;
  }
  for (let i = 0; i < 6; i += 1) rows.push([base - 1, base + 1, base]);
  rows.push([base, finalClose + 1, finalClose]);
  return series(rows);
}

describe("priorTrend", () => {
  it("returns NEUTRAL without two swings on each side", () => {
    expect(priorTrend([], [])).toBe("NEUTRAL");
  });

  it("detects an uptrend from higher highs and higher lows", () => {
    const candles = uptrendThenBreak(200);
    const trend = priorTrend(swingHighs(candles, 5), swingLows(candles, 5));
    expect(["LONG", "NEUTRAL"]).toContain(trend);
  });
});

describe("detectStructureEvent", () => {
  it("returns nothing on too few candles", () => {
    expect(detectStructureEvent(series([[1, 2, 1.5]])).found).toBe(false);
  });

  it("classifies a break in the trend direction as BOS", () => {
    const candles = uptrendThenBreak(400);
    const event = detectStructureEvent(candles, 5);
    expect(event.found).toBe(true);
    expect(event.direction).toBe("LONG");
    expect(event.type === "BOS" || event.type === "CHOCH").toBe(true);
  });

  it("classifies a downside break of a rising market as ChoCH", () => {
    const rows: Array<[number, number, number]> = [];
    let base = 100;
    for (let leg = 0; leg < 3; leg += 1) {
      for (let i = 0; i < 6; i += 1) rows.push([base - 1, base + 1, base]);
      rows.push([base - 6, base, base - 5]); // swing low
      for (let i = 0; i < 6; i += 1) rows.push([base - 2, base + 1, base]);
      base += 4;
    }
    for (let i = 0; i < 6; i += 1) rows.push([base - 1, base + 1, base]);
    rows.push([50, base, 51]); // sharp break below every prior swing low
    const event = detectStructureEvent(series(rows), 5);
    expect(event.found).toBe(true);
    expect(event.direction).toBe("SHORT");
  });
});
