import type { Candle } from "./types";

/**
 * Displacement: an impulsive closed candle whose body exceeds a multiple of ATR
 * and closes in the direction of the setup.
 *
 * `afterIndex` enforces chronology — a displacement that happened BEFORE the
 * sweep or break it is supposed to confirm is not confirmation of anything.
 */

export type DisplacementResult = {
  found: boolean;
  bodyAtr: number | null;
  at: string | null;
  /** Index of the displacement candle in the input series, or null. */
  atIndex: number | null;
};

const NONE: DisplacementResult = { found: false, bodyAtr: null, at: null, atIndex: null };

export function detectDisplacement(
  candles: Candle[],
  direction: "LONG" | "SHORT",
  atrValue: number | null,
  minAtr = 1.0,
  window = 5,
  afterIndex: number | null = null,
): DisplacementResult {
  if (!atrValue || atrValue <= 0 || candles.length === 0) return NONE;
  const start = Math.max(
    0,
    candles.length - window,
    afterIndex === null ? 0 : afterIndex,
  );
  let best: DisplacementResult = NONE;

  for (let i = candles.length - 1; i >= start; i -= 1) {
    const c = candles[i];
    const directional = direction === "LONG" ? c.close > c.open : c.close < c.open;
    if (!directional) continue;
    const bodyAtr = Math.abs(c.close - c.open) / atrValue;
    if (!best.bodyAtr || bodyAtr > best.bodyAtr) {
      best = { found: bodyAtr >= minAtr, bodyAtr, at: c.time, atIndex: i };
    }
  }
  return best;
}
