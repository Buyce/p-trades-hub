/**
 * Point and pip conversion — the single authoritative implementation.
 *
 * A "point" is the smallest quoted increment of the instrument (1e-5 on a
 * 5-digit FX pair, 0.01 on gold). A "pip" is the unit traders actually speak
 * in: on 3- and 5-digit quotes it is ten points, everywhere else it equals the
 * point. Every displayed distance and every stored width goes through here, so
 * a spread can never again reach a screen as `0.00001`.
 */

/** Pip size for an instrument, derived from its point size and digits. */
export function getPipSize(point: number, digits: number): number {
  if (!Number.isFinite(point) || point <= 0) return 0;
  return digits === 3 || digits === 5 ? point * 10 : point;
}

/** A price distance expressed in pips. Returns 0 when the pip size is unknown. */
export function priceDistanceToPips(distance: number, point: number, digits: number): number {
  const pipSize = getPipSize(point, digits);
  return pipSize > 0 ? distance / pipSize : 0;
}

/** A price distance expressed in points. */
export function priceDistanceToPoints(distance: number, point: number): number {
  return Number.isFinite(point) && point > 0 ? distance / point : 0;
}

/** A distance in points converted back to a price distance. */
export function pointsToPrice(points: number, point: number): number {
  return Number.isFinite(point) && point > 0 ? points * point : 0;
}

/**
 * Fallback point size when the instrument row has none: derived from the
 * quoted digits, which every broker reports.
 */
export function pointSizeFor(pointSize: number | null, digits: number | null): number | null {
  if (Number.isFinite(pointSize) && (pointSize as number) > 0) return pointSize as number;
  if (digits === null || !Number.isFinite(digits) || digits < 0) return null;
  return 10 ** -digits;
}
