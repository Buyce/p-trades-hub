import type { Candle, Swing } from "./types";
import { swingHighs, swingLows } from "./swings.server";

/**
 * Market-structure events on closed candles.
 *
 * BOS  (break of structure): price closes beyond the most recent swing in the
 *      direction of the existing structure — continuation.
 * ChoCH (change of character): price closes beyond the most recent opposing
 *      swing against the existing structure — the first sign of a reversal.
 *
 * Deterministic and pure: same candles in, same event out. The break INDEX is
 * returned so a retest can be required to occur strictly AFTER the break.
 */

export type StructureType = "BOS" | "CHOCH";

export type StructureEvent = {
  found: boolean;
  type: StructureType | null;
  direction: "LONG" | "SHORT" | null;
  level: number | null;
  at: string | null;
  /** Index of the breaking candle in the input series, or null. */
  atIndex: number | null;
  priorTrend: "LONG" | "SHORT" | "NEUTRAL";
};

const NONE: StructureEvent = {
  found: false,
  type: null,
  direction: null,
  level: null,
  at: null,
  atIndex: null,
  priorTrend: "NEUTRAL",
};

/** Trend implied by the last two confirmed swing highs and lows. */
export function priorTrend(highs: Swing[], lows: Swing[]): "LONG" | "SHORT" | "NEUTRAL" {
  if (highs.length < 2 || lows.length < 2) return "NEUTRAL";
  const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
  const hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
  const lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
  const ll = lows[lows.length - 1].price < lows[lows.length - 2].price;
  if (hh && hl) return "LONG";
  if (lh && ll) return "SHORT";
  return "NEUTRAL";
}

/**
 * @param afterIndex when set, only candles strictly after this index may count
 *   as the break. Used to require break-after-sweep chronology.
 */
export function detectStructureEvent(
  candles: Candle[],
  lookback = 5,
  window = 6,
  afterIndex: number | null = null,
): StructureEvent {
  if (candles.length < lookback * 2 + 3) return NONE;
  const highs = swingHighs(candles, lookback);
  const lows = swingLows(candles, lookback);
  const trend = priorTrend(highs, lows);
  const start = Math.max(
    0,
    candles.length - window,
    afterIndex === null ? 0 : afterIndex + 1,
  );

  for (let i = candles.length - 1; i >= start; i -= 1) {
    const c = candles[i];
    const high = highs.filter((s) => s.index < i - 1).at(-1);
    const low = lows.filter((s) => s.index < i - 1).at(-1);

    if (high && c.close > high.price) {
      return {
        found: true,
        type: trend === "SHORT" ? "CHOCH" : "BOS",
        direction: "LONG",
        level: high.price,
        at: c.time,
        atIndex: i,
        priorTrend: trend,
      };
    }
    if (low && c.close < low.price) {
      return {
        found: true,
        type: trend === "LONG" ? "CHOCH" : "BOS",
        direction: "SHORT",
        level: low.price,
        at: c.time,
        atIndex: i,
        priorTrend: trend,
      };
    }
  }
  return { ...NONE, priorTrend: trend };
}
