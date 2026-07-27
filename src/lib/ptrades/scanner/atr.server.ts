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

/** How the average of true range is smoothed. Selected by the rulebook. */
export type AtrMethod = "WILDER" | "SMA";

/**
 * ATR over closed candles. Returns null when data is insufficient.
 *
 * `WILDER` (the tuned default, and what live signals have always used) seeds
 * with the first `period` true ranges and then smooths. `SMA` is the plain
 * mean of the last `period` true ranges, kept because the Python reference
 * specification documents it; it is selected only via `rulebook.atr_method`.
 */
export function atr(candles: Candle[], period = 14, method: AtrMethod = "WILDER"): number | null {
  if (candles.length < period + 1) return null;
  const trs = trueRange(candles);
  if (trs.length < period) return null;

  if (method === "SMA") {
    const window = trs.slice(-period);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    return Number.isFinite(mean) ? mean : null;
  }

  const seed = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let value = seed;
  for (let i = period; i < trs.length; i += 1) {
    value = (value * (period - 1) + trs[i]) / period;
  }
  return Number.isFinite(value) ? value : null;
}
