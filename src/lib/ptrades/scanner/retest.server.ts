import type { Candle } from "./types";

/**
 * Breakout and retest: after displacement through a level, price returns to the
 * broken level and holds it on a closed candle.
 */

export type RetestResult = {
  found: boolean;
  level: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  at: string | null;
};

const NONE: RetestResult = { found: false, level: null, entryLow: null, entryHigh: null, at: null };

export function detectRetest(
  candles: Candle[],
  direction: "LONG" | "SHORT",
  level: number | null,
  atrValue: number | null,
  window = 6,
): RetestResult {
  if (level === null || !atrValue || atrValue <= 0 || candles.length === 0) return NONE;
  const tolerance = atrValue * 0.25;
  const start = Math.max(0, candles.length - window);

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
        };
      }
    }
  }
  return NONE;
}
