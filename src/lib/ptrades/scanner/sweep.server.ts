import type { Candle, Swing } from "./types";
import { swingHighs, swingLows } from "./swings.server";

/**
 * Liquidity sweep: price trades through a prior swing level and closes back
 * inside it. Bullish sweep takes out a swing low; bearish takes out a swing high.
 *
 * The candle INDEX of the sweep is returned alongside its timestamp. Chronology
 * downstream (displacement after the sweep, retest after the break) is ordered
 * on that index, never on string timestamps.
 */

export type SweepResult = {
  found: boolean;
  direction: "LONG" | "SHORT" | null;
  level: number | null;
  extreme: number | null;
  sweptAt: string | null;
  /** Index of the sweeping candle in the input series, or null. */
  sweptIndex: number | null;
};

const NONE: SweepResult = {
  found: false,
  direction: null,
  level: null,
  extreme: null,
  sweptAt: null,
  sweptIndex: null,
};

function priorSwings(swings: Swing[], beforeIndex: number): Swing[] {
  return swings.filter((s) => s.index < beforeIndex - 1);
}

export function detectSweep(candles: Candle[], lookback = 5, window = 6): SweepResult {
  if (candles.length < lookback * 2 + 3) return NONE;
  const highs = swingHighs(candles, lookback);
  const lows = swingLows(candles, lookback);
  const start = Math.max(0, candles.length - window);

  for (let i = candles.length - 1; i >= start; i -= 1) {
    const c = candles[i];

    const low = priorSwings(lows, i).at(-1);
    if (low && c.low < low.price && c.close > low.price) {
      return {
        found: true,
        direction: "LONG",
        level: low.price,
        extreme: c.low,
        sweptAt: c.time,
        sweptIndex: i,
      };
    }

    const high = priorSwings(highs, i).at(-1);
    if (high && c.high > high.price && c.close < high.price) {
      return {
        found: true,
        direction: "SHORT",
        level: high.price,
        extreme: c.high,
        sweptAt: c.time,
        sweptIndex: i,
      };
    }
  }
  return NONE;
}
