import type { Candle } from "@/lib/ptrades/scanner/types";

/** Deterministic candle fixtures. No randomness, no clock reads. */

export const MINUTE = 60_000;
export const BASE = Date.UTC(2026, 0, 5, 0, 0, 0);

export function candle(
  index: number,
  ohlc: { open: number; high: number; low: number; close: number },
  stepMs = 5 * MINUTE,
): Candle {
  return {
    time: new Date(BASE + index * stepMs).toISOString(),
    open: ohlc.open,
    high: ohlc.high,
    low: ohlc.low,
    close: ohlc.close,
    volume: 100,
  };
}

/** Flat candles at a fixed price, used as neutral padding around a pivot. */
export function flat(count: number, price: number, startIndex = 0, stepMs = 5 * MINUTE): Candle[] {
  return Array.from({ length: count }, (_, i) =>
    candle(
      startIndex + i,
      { open: price, high: price + 0.5, low: price - 0.5, close: price },
      stepMs,
    ),
  );
}

/** Builds a series from close prices, deriving a small symmetric range. */
export function fromCloses(closes: number[], range = 1, stepMs = 5 * MINUTE): Candle[] {
  return closes.map((close, i) =>
    candle(
      i,
      {
        open: i === 0 ? close : closes[i - 1],
        high: Math.max(close, i === 0 ? close : closes[i - 1]) + range,
        low: Math.min(close, i === 0 ? close : closes[i - 1]) - range,
        close,
      },
      stepMs,
    ),
  );
}

/** The close timestamp of the last candle in a fixed-interval series. */
export function closeTimeOf(candles: Candle[], stepMs: number): number {
  const last = candles[candles.length - 1];
  return Date.parse(last.time) + stepMs;
}
