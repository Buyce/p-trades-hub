/**
 * Canonical structural idea identity.
 *
 * Two setup families frequently describe the SAME market idea: a sweep of the
 * same swing low and a change of character off that low are one trade, not two.
 * Fingerprints included the family, so both opened a watch and both could
 * alert. The structural idea id deliberately EXCLUDES the family: it is the
 * instrument, the direction, the structural level bucketed by volatility, and
 * the UTC trading day.
 *
 * Bucketing by a fraction of ATR is what makes it stable — the same level
 * measured on two consecutive scans differs by a few points, and an exact price
 * would produce a new "idea" every minute.
 */

export const IDEA_LEVEL_ATR_BUCKET = 0.25;

export function structuralIdeaId(args: {
  instrument: string;
  direction: "LONG" | "SHORT";
  level: number | null;
  atr: number | null;
  tradingDayUtc: string;
  bucketAtrFraction?: number;
}): string {
  const { instrument, direction, level, atr, tradingDayUtc } = args;
  const fraction = args.bucketAtrFraction ?? IDEA_LEVEL_ATR_BUCKET;
  const bucketSize = atr && atr > 0 ? atr * fraction : null;
  const bucket =
    level === null
      ? "nolevel"
      : bucketSize
        ? String(Math.round(level / bucketSize))
        : level.toFixed(6);
  return [instrument, direction, `L${bucket}`, tradingDayUtc].join("|");
}
