import type { Candle, Timeframe } from "./types";
import { TIMEFRAME_SECONDS } from "./types";

/**
 * Candle sanity. Bad broker data must reject a setup rather than silently
 * produce nonsense levels. Every rule here is fail-closed.
 */

export type SanityResult = {
  ok: boolean;
  problems: string[];
  checked: number;
};

export function checkCandleSanity(
  candles: Candle[],
  timeframe: Timeframe,
  sample = 60,
  maxGapMultiple = 6,
): SanityResult {
  const problems: string[] = [];
  const slice = candles.slice(-sample);
  if (slice.length === 0) return { ok: false, problems: ["No candles supplied."], checked: 0 };

  const step = TIMEFRAME_SECONDS[timeframe] * 1000;
  let previousTime: number | null = null;

  for (const c of slice) {
    const t = Date.parse(c.time);
    if (!Number.isFinite(t)) problems.push(`Invalid candle timestamp ${c.time}.`);
    if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)) {
      problems.push(`Non-positive or non-finite price at ${c.time}.`);
      // The candle is unusable for price checks, but its timestamp still
      // advances the series: without this the next gap is measured from the
      // candle before it and reports a gap that does not exist.
      if (Number.isFinite(t)) previousTime = t;
      continue;
    }

    if (c.high < c.low) problems.push(`High below low at ${c.time}.`);
    if (c.high < Math.max(c.open, c.close)) problems.push(`High below body at ${c.time}.`);
    if (c.low > Math.min(c.open, c.close)) problems.push(`Low above body at ${c.time}.`);
    if (previousTime !== null) {
      if (t === previousTime) problems.push(`Duplicate candle timestamp at ${c.time}.`);
      else if (t < previousTime) problems.push(`Out-of-order candle at ${c.time}.`);
      else if (t - previousTime > step * maxGapMultiple) {
        problems.push(`Data gap of ${(t - previousTime) / step} candles before ${c.time}.`);
      }
    }
    previousTime = t;
  }

  return { ok: problems.length === 0, problems: problems.slice(0, 5), checked: slice.length };
}
