/**
 * Execution zone construction — the single authoritative implementation.
 *
 * Two rules distinguish this from the old symmetric ATR band:
 *
 *  1. The width adapts to what actually makes a fill possible: the spread, and
 *     the smaller of the two short-timeframe volatilities. It is then clamped
 *     to the instrument's configured floor and ceiling.
 *  2. The zone is asymmetric. It extends only in the direction that improves
 *     the entry, never in the chasing direction, so a long is never told to buy
 *     above its anchor.
 */

import { pointsToPrice } from "./pips.server";

export type ZoneWidthInput = {
  /** Current spread, in points. */
  spreadPoints: number;
  /** ATR of the M1 series, in price. */
  atrM1: number;
  /** ATR of the M5 series, in price. */
  atrM5: number;
  /** Instrument point size, in price. */
  point: number;
  minimumWidthPoints: number;
  maximumWidthPoints: number;
  spreadMultiplier: number;
  atrM1Multiplier: number;
  atrM5Multiplier: number;
};

/**
 * Adaptive zone width in points.
 *
 * The zone must at minimum absorb the spread, and beyond that it tracks the
 * calmer of the two volatility readings — using the larger would reintroduce
 * the broad zone the engine exists to remove.
 */
export function calculateAdaptiveZoneWidthPoints(input: ZoneWidthInput): number {
  const point = Number.isFinite(input.point) && input.point > 0 ? input.point : 0;
  const spreadWidth = Math.max(0, input.spreadPoints) * input.spreadMultiplier;
  const atrM1Width = point > 0 ? (input.atrM1 / point) * input.atrM1Multiplier : 0;
  const atrM5Width = point > 0 ? (input.atrM5 / point) * input.atrM5Multiplier : 0;

  const volatilityWidth =
    atrM1Width > 0 && atrM5Width > 0
      ? Math.min(atrM1Width, atrM5Width)
      : Math.max(atrM1Width, atrM5Width);

  const raw = Math.max(spreadWidth, volatilityWidth);
  return Math.min(input.maximumWidthPoints, Math.max(input.minimumWidthPoints, raw));
}

export type ExecutionZone = {
  preferredEntry: number;
  entryLow: number;
  entryHigh: number;
  zoneWidthPoints: number;
};

/**
 * Asymmetric execution zone around the anchor.
 *
 *  LONG  → [anchor − width, anchor]: only better prices are acceptable.
 *  SHORT → [anchor, anchor + width]: only higher (better) prices are acceptable.
 */
export function buildExecutionZone(params: {
  preferredEntry: number;
  direction: "LONG" | "SHORT";
  zoneWidthPoints: number;
  point: number;
}): ExecutionZone {
  const { preferredEntry, direction, zoneWidthPoints, point } = params;
  const width = pointsToPrice(Math.max(0, zoneWidthPoints), point);
  return {
    preferredEntry,
    entryLow: direction === "LONG" ? preferredEntry - width : preferredEntry,
    entryHigh: direction === "LONG" ? preferredEntry : preferredEntry + width,
    zoneWidthPoints,
  };
}
