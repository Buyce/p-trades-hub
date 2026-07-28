/**
 * Execution-timing arithmetic: how close price is to the planned entry, and
 * how far it has already run past it. Pure functions — nothing here reads the
 * feed, the clock or the database.
 */

export type Direction = "LONG" | "SHORT";

/** True when the live quote sits inside `proximityPoints` of the entry. */
export function isPriceNearEntry(
  currentPrice: number,
  preferredEntry: number,
  point: number,
  proximityPoints: number,
): boolean {
  if (!Number.isFinite(point) || point <= 0) return false;
  return Math.abs(currentPrice - preferredEntry) / point <= proximityPoints;
}

/** Distance from the preferred entry, in points. Always non-negative. */
export function distanceToEntryPoints(
  currentPrice: number,
  preferredEntry: number,
  point: number,
): number {
  if (!Number.isFinite(point) || point <= 0) return 0;
  return Math.abs(currentPrice - preferredEntry) / point;
}

/**
 * How far price has already travelled in the trade's favour, measured in R.
 * A positive value means the move has begun without us; a negative value means
 * price has not yet reached the planned entry. Infinite when risk is undefined,
 * which fails the late-entry check closed.
 */
export function calculateExtensionR(
  direction: Direction,
  plannedEntry: number,
  currentPrice: number,
  stopLoss: number,
): number {
  const risk = Math.abs(plannedEntry - stopLoss);
  if (!(risk > 0) || !Number.isFinite(risk)) return Number.POSITIVE_INFINITY;
  const move =
    direction === "LONG" ? currentPrice - plannedEntry : plannedEntry - currentPrice;
  return move / risk;
}

/**
 * True when the first target was already reached before an entry existed. The
 * move is over; converting that into an alert is chasing.
 */
export function targetAlreadyTouched(
  direction: Direction,
  target: number | null | undefined,
  extremeSinceArmed: number | null | undefined,
): boolean {
  if (target === null || target === undefined) return false;
  if (extremeSinceArmed === null || extremeSinceArmed === undefined) return false;
  return direction === "LONG" ? extremeSinceArmed >= target : extremeSinceArmed <= target;
}
