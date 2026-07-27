import { describe, expect, it } from "vitest";
import {
  closedCandlesOnly,
  dataAgeSeconds,
  isClosed,
  lastClosed,
  sortAscending,
} from "../candles.server";
import { candle, BASE, MINUTE } from "./fixtures";

/**
 * Spec: bars(closed_only=True) starts from position 1 and excludes the active
 * candle. No setup may ever confirm on an unfinished candle.
 */

const STEP = 5 * MINUTE;

function series(count: number) {
  return Array.from({ length: count }, (_, i) =>
    candle(i, { open: 10, high: 11, low: 9, close: 10 }),
  );
}

describe("isClosed", () => {
  it("treats a candle as closed only once its full period has elapsed", () => {
    const c = candle(0, { open: 1, high: 2, low: 0, close: 1 });
    expect(isClosed(c, "M5", BASE + STEP - 1)).toBe(false);
    expect(isClosed(c, "M5", BASE + STEP)).toBe(true);
  });
});

describe("closedCandlesOnly", () => {
  it("drops the currently forming candle", () => {
    const candles = series(4);
    // "now" sits inside the fourth candle's period.
    const now = BASE + 3 * STEP + 60_000;
    const closed = closedCandlesOnly(candles, "M5", now);
    expect(closed).toHaveLength(3);
    expect(closed.at(-1)!.time).toBe(candles[2].time);
  });

  it("keeps every candle once all periods have elapsed", () => {
    const candles = series(4);
    expect(closedCandlesOnly(candles, "M5", BASE + 10 * STEP)).toHaveLength(4);
  });

  it("sorts out-of-order input ascending by time", () => {
    const candles = series(3);
    const shuffled = [candles[2], candles[0], candles[1]];
    const closed = closedCandlesOnly(shuffled, "M5", BASE + 10 * STEP);
    expect(closed.map((c) => c.time)).toEqual(candles.map((c) => c.time));
  });

  it("drops candles containing non-finite prices", () => {
    const candles = series(3);
    candles[1] = { ...candles[1], high: Number.NaN };
    expect(closedCandlesOnly(candles, "M5", BASE + 10 * STEP)).toHaveLength(2);
  });

  it("returns an empty list rather than throwing on empty input", () => {
    expect(closedCandlesOnly([], "M5", BASE)).toEqual([]);
  });
});

describe("sortAscending", () => {
  it("does not mutate the input array", () => {
    const candles = series(3);
    const shuffled = [candles[2], candles[0], candles[1]];
    const before = [...shuffled];
    sortAscending(shuffled);
    expect(shuffled).toEqual(before);
  });
});

describe("lastClosed", () => {
  it("returns the final candle, or null when empty", () => {
    const candles = series(3);
    expect(lastClosed(candles)).toBe(candles[2]);
    expect(lastClosed([])).toBeNull();
  });
});

describe("dataAgeSeconds", () => {
  it("measures age from the candle close, not the candle open", () => {
    const candles = series(2);
    // Second candle opens at BASE + STEP and closes at BASE + 2*STEP.
    const now = BASE + 2 * STEP + 90_000;
    expect(dataAgeSeconds(candles, "M5", now)).toBe(90);
  });

  it("never reports a negative age", () => {
    const candles = series(1);
    expect(dataAgeSeconds(candles, "M5", BASE)).toBe(0);
  });

  it("returns null when there is no candle", () => {
    expect(dataAgeSeconds([], "M5", BASE)).toBeNull();
  });
});
