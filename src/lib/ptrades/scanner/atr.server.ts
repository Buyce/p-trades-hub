import type { Candle } from "./types";

/**
 * True range for each candle after the first, using the three standard
 * components: current range, gap up from the previous close, gap down from the
 * previous close. Index 0 has no previous close and is therefore excluded.
 */
export function trueRange(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    out.push(
      Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)),
    );
  }
  return out;
}

/** Wilder-style ATR over closed candles. Returns null when data is insufficient. */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs = trueRange(candles);
  const seed = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let value = seed;
  for (let i = period; i < trs.length; i += 1) {
    value = (value * (period - 1) + trs[i]) / period;
  }
  return Number.isFinite(value) ? value : null;
}
