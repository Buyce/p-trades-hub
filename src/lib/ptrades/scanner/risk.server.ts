/**
 * Risk geometry. Pure arithmetic on values the scanner already derived —
 * nothing here decides whether a trade should be taken, and nothing here
 * places one.
 */

/** Structural risk per unit: the distance between entry and stop. */
export function risk(entry: number | null, stop: number | null): number | null {
  if (entry === null || stop === null) return null;
  if (!Number.isFinite(entry) || !Number.isFinite(stop)) return null;
  const value = Math.abs(entry - stop);
  return value > 0 ? value : null;
}

/**
 * Reward-to-risk for a single target. Returns null when risk is undefined or
 * when the target sits on the wrong side of the entry.
 */
export function rewardToRisk(
  entry: number | null,
  stop: number | null,
  target: number | null,
): number | null {
  const r = risk(entry, stop);
  if (r === null || target === null || !Number.isFinite(target)) return null;
  const direction = entry! > stop! ? 1 : -1;
  const reward = (target - entry!) * direction;
  if (reward <= 0) return null;
  return reward / r;
}

/** Standard 2R and 3R targets measured from the entry against the stop. */
export function targetsFrom(
  entry: number,
  stop: number,
  direction: "LONG" | "SHORT",
  multiples: number[] = [2, 3],
): number[] {
  const r = Math.abs(entry - stop);
  if (!(r > 0)) return [];
  const sign = direction === "LONG" ? 1 : -1;
  return multiples.map((m) => entry + sign * r * m);
}
