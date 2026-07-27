import type { Bias, Candle } from "./types";
import { lastSwing, swingHighs, swingLows } from "./swings.server";

/**
 * Higher-timeframe bias from closed H4 and D1 candles.
 * Deterministic: structure (higher highs / lower lows) plus close position.
 */

function structureBias(candles: Candle[], lookback: number): Bias {
  const highs = swingHighs(candles, lookback);
  const lows = swingLows(candles, lookback);
  if (highs.length < 2 || lows.length < 2) return "NEUTRAL";
  const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
  const hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
  const lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
  const ll = lows[lows.length - 1].price < lows[lows.length - 2].price;
  if (hh && hl) return "LONG";
  if (lh && ll) return "SHORT";
  return "NEUTRAL";
}

export function higherTimeframeBias(
  h4: Candle[],
  d1: Candle[],
  lookback = 5,
): { bias: Bias; h4: Bias; d1: Bias } {
  const biasH4 = structureBias(h4, lookback);
  const biasD1 = structureBias(d1, lookback);
  if (biasH4 === biasD1) return { bias: biasH4, h4: biasH4, d1: biasD1 };
  if (biasD1 === "NEUTRAL") return { bias: biasH4, h4: biasH4, d1: biasD1 };
  if (biasH4 === "NEUTRAL") return { bias: biasD1, h4: biasH4, d1: biasD1 };
  return { bias: "NEUTRAL", h4: biasH4, d1: biasD1 };
}

export function referenceLevels(h1: Candle[], lookback = 5) {
  return {
    swingHigh: lastSwing(swingHighs(h1, lookback)),
    swingLow: lastSwing(swingLows(h1, lookback)),
  };
}
