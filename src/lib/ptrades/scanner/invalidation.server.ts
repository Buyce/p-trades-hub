/**
 * Structural invalidation — the price and the condition that prove the setup
 * wrong. A setup without one cannot be armed and cannot alert: "Invalidation:
 * Unavailable" is not a tradable instruction, it is missing information.
 *
 * The invalidation price is the structural extreme the stop protects, not the
 * stop itself. Price closing beyond it means the market accepted the level the
 * setup said it would reject.
 */

export type InvalidationResult = {
  price: number | null;
  condition: string | null;
  timeframe: string | null;
};

const NONE: InvalidationResult = { price: null, condition: null, timeframe: null };

export function buildInvalidation(params: {
  direction: "LONG" | "SHORT";
  /** Structural extreme the setup must hold (sweep wick, protected swing). */
  extreme: number | null;
  /** Broken level the setup traded from, used when no extreme is available. */
  level: number | null;
  timeframe: string;
  digits: number | null;
}): InvalidationResult {
  const anchor =
    params.extreme !== null && Number.isFinite(params.extreme)
      ? params.extreme
      : params.level !== null && Number.isFinite(params.level)
        ? params.level
        : null;
  if (anchor === null) return NONE;

  const price =
    params.digits === null || params.digits < 0 ? anchor : Number(anchor.toFixed(params.digits));
  const side = params.direction === "LONG" ? "below" : "above";

  return {
    price,
    condition: `${params.timeframe} acceptance ${side} ${price}`,
    timeframe: params.timeframe,
  };
}

/** True when a candidate carries a usable structural invalidation. */
export function hasInvalidation(result: InvalidationResult | null | undefined): boolean {
  return Boolean(result && result.price !== null && result.condition);
}

/** True when a closed candle has accepted beyond the invalidation price. */
export function isInvalidated(
  direction: "LONG" | "SHORT",
  invalidationPrice: number | null,
  closedPrice: number | null,
): boolean {
  if (invalidationPrice === null || closedPrice === null) return false;
  return direction === "LONG" ? closedPrice < invalidationPrice : closedPrice > invalidationPrice;
}
