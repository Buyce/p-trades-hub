import type { Candle, Timeframe } from "./types";
import { TIMEFRAME_SECONDS } from "./types";

/**
 * Candle normalisation. The single place that guarantees the currently forming
 * candle is never used for confirmation.
 */

export function sortAscending(candles: Candle[]): Candle[] {
  return [...candles].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export function isClosed(candle: Candle, timeframe: Timeframe, now = Date.now()): boolean {
  const closeAt = Date.parse(candle.time) + TIMEFRAME_SECONDS[timeframe] * 1000;
  return closeAt <= now;
}

/** Drops any candle whose period has not fully elapsed. */
export function closedCandlesOnly(
  candles: Candle[],
  timeframe: Timeframe,
  now = Date.now(),
): Candle[] {
  return sortAscending(candles).filter(
    (c) =>
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&
      isClosed(c, timeframe, now),
  );
}

export function lastClosed(candles: Candle[]): Candle | null {
  return candles.length ? candles[candles.length - 1] : null;
}

/** Age in seconds of the most recent closed candle's close time. */
export function dataAgeSeconds(
  candles: Candle[],
  timeframe: Timeframe,
  now = Date.now(),
): number | null {
  const last = lastClosed(candles);
  if (!last) return null;
  const closeAt = Date.parse(last.time) + TIMEFRAME_SECONDS[timeframe] * 1000;
  return Math.max(0, (now - closeAt) / 1000);
}
