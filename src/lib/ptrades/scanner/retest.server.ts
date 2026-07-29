import type { Candle } from "./types";

/**
 * Breakout and retest: after displacement through a level, price returns to the
 * broken level and holds it on a closed candle.
 *
 * CHRONOLOGY: the retest must happen on a candle STRICTLY AFTER the break. The
 * break candle itself trades through the level and closes beyond it, so without
 * this rule the break candle satisfies "touched and held" and every break was
 * reported as an already-completed break-and-retest.
 */

export type RetestResult = {
  found: boolean;
  level: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  at: string | null;
  /** Index of the retesting candle in the input series, or null. */
  atIndex: number | null;
};

const NONE: RetestResult = {
  found: false,
  level: null,
  entryLow: null,
  entryHigh: null,
  at: null,
  atIndex: null,
};

export function detectRetest(
  candles: Candle[],
  direction: "LONG" | "SHORT",
  level: number | null,
  atrValue: number | null,
  window = 6,
  afterIndex: number | null = null,
): RetestResult {
  if (level === null || !atrValue || atrValue <= 0 || candles.length === 0) return NONE;
  const tolerance = atrValue * 0.25;
  const start = Math.max(
    0,
    candles.length - window,
    afterIndex === null ? 0 : afterIndex + 1,
  );

  for (let i = candles.length - 1; i >= start; i -= 1) {
    const c = candles[i];
    if (direction === "LONG") {
      const touched = c.low <= level + tolerance;
      const held = c.close > level;
      if (touched && held) {
        return {
          found: true,
          level,
          entryLow: level - tolerance * 0.5,
          entryHigh: level + tolerance,
          at: c.time,
          atIndex: i,
        };
      }
    } else {
      const touched = c.high >= level - tolerance;
      const held = c.close < level;
      if (touched && held) {
        return {
          found: true,
          level,
          entryLow: level - tolerance,
          entryHigh: level + tolerance * 0.5,
          at: c.time,
          atIndex: i,
        };
      }
    }
  }
  return NONE;
}
