import type { Candle, Swing } from "./types";

/**
 * Fractal swing detection over closed candles.
 * A swing high is a candle whose high exceeds `lookback` candles either side.
 */

export function swingHighs(candles: Candle[], lookback = 5): Swing[] {
  const out: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    const pivot = candles[i].high;
    let ok = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j !== i && candles[j].high >= pivot) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ index: i, price: pivot, time: candles[i].time });
  }
  return out;
}

export function swingLows(candles: Candle[], lookback = 5): Swing[] {
  const out: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    const pivot = candles[i].low;
    let ok = true;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (j !== i && candles[j].low <= pivot) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ index: i, price: pivot, time: candles[i].time });
  }
  return out;
}

export function lastSwing(swings: Swing[]): Swing | null {
  return swings.length ? swings[swings.length - 1] : null;
}
