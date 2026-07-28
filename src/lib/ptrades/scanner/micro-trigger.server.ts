/**
 * Micro trigger — the execution half of the engine.
 *
 * The M15 setup says *what* to trade. This module says *when*: it walks the
 * closed M1 series and requires the full sequence, in order, before an entry is
 * allowed to exist:
 *
 *   1. a rejection candle at the armed area,
 *   2. a displacement candle away from it,
 *   3. a close beyond the protected micro swing (micro BOS/CHOCH),
 *   4. a later candle that retests the broken micro level,
 *   5. that retest holding on the close.
 *
 * Every step is measured on a closed candle. The forming candle is removed
 * upstream by `normaliseCandles`, so nothing here can act on an unfinished bar.
 * Reuses the existing swing and displacement primitives — no second copy of
 * either lives here.
 */

import type { Candle } from "./types";
import { swingHighs, swingLows } from "./swings.server";

export type MicroDirection = "LONG" | "SHORT";

export type MicroTriggerResult = {
  confirmed: boolean;
  direction: MicroDirection;
  rejectionCandleTime: string | null;
  displacementCandleTime: string | null;
  bosCandleTime: string | null;
  brokenLevel: number | null;
  retestCandleTime: string | null;
  /** True once steps 1-3 completed, even if the retest has not arrived yet. */
  triggered: boolean;
  summary: string | null;
  reasons: string[];
  failures: string[];
};

function empty(direction: MicroDirection, failures: string[]): MicroTriggerResult {
  return {
    confirmed: false,
    direction,
    rejectionCandleTime: null,
    displacementCandleTime: null,
    bosCandleTime: null,
    brokenLevel: null,
    retestCandleTime: null,
    triggered: false,
    summary: null,
    reasons: [],
    failures,
  };
}

/** A rejection candle: a long wick into the zone with a close back out of it. */
function isRejection(candle: Candle, direction: MicroDirection): boolean {
  const range = candle.high - candle.low;
  if (!(range > 0)) return false;
  const body = Math.abs(candle.close - candle.open);
  if (body > range * 0.6) return false;
  if (direction === "LONG") {
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    return lowerWick >= range * 0.4 && candle.close >= candle.low + range * 0.5;
  }
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  return upperWick >= range * 0.4 && candle.close <= candle.high - range * 0.5;
}

/** Touched the armed zone at any point in the candle. */
function touchesZone(candle: Candle, low: number, high: number): boolean {
  return candle.low <= high && candle.high >= low;
}

export type MicroTriggerInput = {
  /** Closed M1 candles, oldest first. */
  candles: Candle[];
  direction: MicroDirection;
  /** Armed execution zone the setup is waiting on. */
  zoneLow: number;
  zoneHigh: number;
  /** ATR of the M1 series. */
  atrM1: number | null;
  /** Displacement body size required, as a multiple of the M1 ATR. */
  displacementMinAtr?: number;
  /** Micro swing lookback used to find the protected level. */
  swingLookback?: number;
  /** Closed candles allowed between the micro BOS and its retest. */
  retestWithinBars?: number;
  /** How many recent candles to search for the rejection. */
  window?: number;
};

export function detectMicroTrigger(input: MicroTriggerInput): MicroTriggerResult {
  const {
    candles,
    direction,
    zoneLow,
    zoneHigh,
    atrM1,
    displacementMinAtr = 0.8,
    swingLookback = 2,
    retestWithinBars = 3,
    window = 20,
  } = input;

  if (candles.length < swingLookback * 2 + 4) {
    return empty(direction, ["Not enough closed M1 candles to assess a micro trigger."]);
  }
  if (!atrM1 || atrM1 <= 0) {
    return empty(direction, ["M1 ATR unavailable, so displacement cannot be measured."]);
  }

  const reasons: string[] = [];
  const failures: string[] = [];
  const start = Math.max(swingLookback, candles.length - window);

  const highs = swingHighs(candles, swingLookback);
  const lows = swingLows(candles, swingLookback);

  // 1. Rejection at the armed zone, searched newest-first so the most recent
  //    attempt at the level is the one being evaluated.
  let rejectionIndex = -1;
  for (let i = candles.length - 1; i >= start; i -= 1) {
    if (touchesZone(candles[i], zoneLow, zoneHigh) && isRejection(candles[i], direction)) {
      rejectionIndex = i;
      break;
    }
  }
  if (rejectionIndex < 0) {
    failures.push("No closed M1 rejection candle at the armed entry area.");
    return { ...empty(direction, failures), reasons };
  }
  reasons.push(`M1 rejection at ${candles[rejectionIndex].time}.`);

  // 2. Displacement away from the zone, on or after the rejection.
  let displacementIndex = -1;
  for (let i = rejectionIndex; i < candles.length; i += 1) {
    const c = candles[i];
    const directional = direction === "LONG" ? c.close > c.open : c.close < c.open;
    if (!directional) continue;
    if (Math.abs(c.close - c.open) / atrM1 >= displacementMinAtr) {
      displacementIndex = i;
      break;
    }
  }
  if (displacementIndex < 0) {
    failures.push("No M1 displacement candle away from the entry area.");
    return {
      ...empty(direction, failures),
      rejectionCandleTime: candles[rejectionIndex].time,
      reasons,
    };
  }
  reasons.push(`M1 displacement at ${candles[displacementIndex].time}.`);

  // 3. Close beyond the protected micro swing — the micro break of structure.
  let bosIndex = -1;
  let brokenLevel: number | null = null;
  for (let i = displacementIndex; i < candles.length; i += 1) {
    const protectedSwing =
      direction === "LONG"
        ? highs.filter((s) => s.index < i - 1).at(-1)
        : lows.filter((s) => s.index < i - 1).at(-1);
    if (!protectedSwing) continue;
    const broke =
      direction === "LONG"
        ? candles[i].close > protectedSwing.price
        : candles[i].close < protectedSwing.price;
    if (broke) {
      bosIndex = i;
      brokenLevel = protectedSwing.price;
      break;
    }
  }
  if (bosIndex < 0 || brokenLevel === null) {
    failures.push("M1 price has not closed beyond the protected micro swing.");
    return {
      ...empty(direction, failures),
      rejectionCandleTime: candles[rejectionIndex].time,
      displacementCandleTime: candles[displacementIndex].time,
      reasons,
    };
  }
  reasons.push(`M1 ${direction === "LONG" ? "bullish" : "bearish"} BOS through ${brokenLevel}.`);

  const triggeredCore = {
    direction,
    rejectionCandleTime: candles[rejectionIndex].time,
    displacementCandleTime: candles[displacementIndex].time,
    bosCandleTime: candles[bosIndex].time,
    brokenLevel,
    triggered: true,
  };

  // 4/5. A later closed candle returns to the broken level and holds it.
  const tolerance = atrM1 * 0.5;
  const limit = Math.min(candles.length - 1, bosIndex + retestWithinBars);
  for (let i = bosIndex + 1; i <= limit; i += 1) {
    const c = candles[i];
    const touched =
      direction === "LONG" ? c.low <= brokenLevel + tolerance : c.high >= brokenLevel - tolerance;
    const held = direction === "LONG" ? c.close > brokenLevel : c.close < brokenLevel;
    if (touched && held) {
      reasons.push(`M1 retest of ${brokenLevel} held at ${c.time}.`);
      return {
        ...triggeredCore,
        confirmed: true,
        retestCandleTime: c.time,
        summary: `M1 ${direction === "LONG" ? "bullish" : "bearish"} BOS retest confirmed`,
        reasons,
        failures,
      };
    }
  }

  failures.push("The broken M1 level has not been retested and held on a closed candle.");
  return {
    ...triggeredCore,
    confirmed: false,
    retestCandleTime: null,
    summary: `M1 ${direction === "LONG" ? "bullish" : "bearish"} BOS awaiting retest`,
    reasons,
    failures,
  };
}

/**
 * Step 1-3 search: used only while a watch is still ARMED. This is the
 * expensive half of the engine, so it must not run again once a trigger has
 * been persisted.
 */
export const detectNewMicroTrigger = detectMicroTrigger;

export type PersistedTrigger = {
  /** The micro level that was broken, persisted at trigger time. */
  brokenLevel: number;
  /** Close time of the BOS candle, persisted at trigger time. */
  bosCandleTime: string | null;
  direction: MicroDirection;
};

/**
 * Retest-only evaluation for a watch that is already MICRO_TRIGGERED.
 *
 * The rejection, displacement and break of structure already happened and are
 * stored on the watch. Re-running the whole search every pass could pick a
 * different, later sequence and silently move the level a trade is planned
 * from — so here we only ask the one remaining question: has a closed candle
 * after the BOS returned to the persisted level and held it?
 *
 * The original retest deadline is owned by the caller and is never restarted.
 */
export function detectPersistedTriggerRetest(input: {
  /** Closed M1 candles, oldest first. */
  candles: Candle[];
  trigger: PersistedTrigger;
  atrM1: number | null;
  /** Closed candles allowed between the micro BOS and its retest. */
  retestWithinBars?: number;
}): MicroTriggerResult {
  const { candles, trigger, atrM1, retestWithinBars = 3 } = input;
  const { direction, brokenLevel, bosCandleTime } = trigger;

  const base: MicroTriggerResult = {
    confirmed: false,
    direction,
    rejectionCandleTime: null,
    displacementCandleTime: null,
    bosCandleTime,
    brokenLevel,
    retestCandleTime: null,
    triggered: true,
    summary: `M1 ${direction === "LONG" ? "bullish" : "bearish"} BOS awaiting retest`,
    reasons: [`Persisted M1 BOS through ${brokenLevel}.`],
    failures: [],
  };

  if (!atrM1 || atrM1 <= 0) {
    return {
      ...base,
      failures: ["M1 ATR unavailable, so the retest tolerance cannot be measured."],
    };
  }

  const bosIndex = bosCandleTime ? candles.findIndex((c) => c.time === bosCandleTime) : -1;
  // If the BOS candle has aged out of the fetched window, every candle we hold
  // is after it, so the whole window is a valid search range.
  const from = bosIndex >= 0 ? bosIndex + 1 : 0;
  const limit =
    bosIndex >= 0 ? Math.min(candles.length - 1, bosIndex + retestWithinBars) : candles.length - 1;

  const tolerance = atrM1 * 0.5;
  for (let i = from; i <= limit; i += 1) {
    const c = candles[i];
    if (!c) continue;
    const touched =
      direction === "LONG" ? c.low <= brokenLevel + tolerance : c.high >= brokenLevel - tolerance;
    const held = direction === "LONG" ? c.close > brokenLevel : c.close < brokenLevel;
    if (touched && held) {
      return {
        ...base,
        confirmed: true,
        retestCandleTime: c.time,
        summary: `M1 ${direction === "LONG" ? "bullish" : "bearish"} BOS retest confirmed`,
        reasons: [...base.reasons, `M1 retest of ${brokenLevel} held at ${c.time}.`],
      };
    }
  }

  return {
    ...base,
    failures: ["The broken M1 level has not been retested and held on a closed candle."],
  };
}
