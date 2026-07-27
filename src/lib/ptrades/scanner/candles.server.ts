import type { Candle, Timeframe } from "./types";
import { TIMEFRAME_SECONDS } from "./types";
import { isClosedCandle } from "../time";

/**
 * Candle normalisation. The single place that guarantees the currently forming
 * candle is never used for confirmation, and the single place that decides
 * whether a raw candle from the market-data adapter is usable at all.
 */

export function sortAscending(candles: Candle[]): Candle[] {
  return [...candles].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export function isClosed(candle: Candle, timeframe: Timeframe, now = Date.now()): boolean {
  return isClosedCandle(candle.time, timeframe, now);
}

export type CandleReject = {
  index: number;
  time: string | null;
  reason:
    | "INVALID_TIME"
    | "NON_FINITE_PRICE"
    | "NON_POSITIVE_PRICE"
    | "INVERTED_RANGE"
    | "BODY_OUTSIDE_RANGE"
    | "DUPLICATE_TIME"
    | "NOT_CLOSED";
};

export type NormalisedCandles = {
  candles: Candle[];
  rejected: CandleReject[];
};

function malformedReason(c: Candle): CandleReject["reason"] | null {
  const values = [c.open, c.high, c.low, c.close];
  if (values.some((v) => typeof v !== "number" || !Number.isFinite(v))) return "NON_FINITE_PRICE";
  if (values.some((v) => v <= 0)) return "NON_POSITIVE_PRICE";
  if (c.high < c.low) return "INVERTED_RANGE";
  if (c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) {
    return "BODY_OUTSIDE_RANGE";
  }
  return null;
}

/**
 * Sorts, de-duplicates, validates and drops the forming candle. Malformed
 * candles are never repaired or interpolated — they are dropped and reported so
 * the caller can record them. Fail closed: a series with rejects is still
 * returned, and the caller's data-sufficiency gate decides what happens next.
 */
export function normaliseCandles(
  raw: Candle[],
  timeframe: Timeframe,
  now = Date.now(),
): NormalisedCandles {
  const rejected: CandleReject[] = [];
  const seen = new Set<number>();
  const candles: Candle[] = [];

  sortAscending(raw ?? []).forEach((c, index) => {
    const ms = Date.parse(c?.time ?? "");
    if (Number.isNaN(ms)) {
      rejected.push({ index, time: c?.time ?? null, reason: "INVALID_TIME" });
      return;
    }
    const bad = malformedReason(c);
    if (bad) {
      rejected.push({ index, time: c.time, reason: bad });
      return;
    }
    if (seen.has(ms)) {
      rejected.push({ index, time: c.time, reason: "DUPLICATE_TIME" });
      return;
    }
    if (!isClosedCandle(c.time, timeframe, now)) {
      rejected.push({ index, time: c.time, reason: "NOT_CLOSED" });
      return;
    }
    seen.add(ms);
    candles.push(c);
  });

  return { candles, rejected };
}

/** Drops any candle that is malformed or whose period has not fully elapsed. */
export function closedCandlesOnly(
  candles: Candle[],
  timeframe: Timeframe,
  now = Date.now(),
): Candle[] {
  return normaliseCandles(candles, timeframe, now).candles;
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
