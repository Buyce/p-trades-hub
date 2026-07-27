import { createHash } from "crypto";

/**
 * Duplicate fingerprinting: the same instrument, direction, setup and price
 * geometry on the same UTC day is one idea, not two.
 */

function round(value: number | null, step: number): string {
  if (value === null || !Number.isFinite(value)) return "na";
  return (Math.round(value / step) * step).toFixed(6);
}

export function fingerprint(input: {
  instrument: string;
  direction: string;
  setupType: string;
  timeframe: string;
  tradingDayUtc: string;
  entry: number | null;
  stop: number | null;
  atr: number | null;
}): string {
  const step = input.atr && input.atr > 0 ? input.atr * 0.25 : 0.0001;
  const parts = [
    input.instrument,
    input.direction,
    input.setupType,
    input.timeframe,
    input.tradingDayUtc,
    round(input.entry, step),
    round(input.stop, step),
  ].join("|");
  return createHash("sha256").update(parts).digest("hex").slice(0, 32);
}
