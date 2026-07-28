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

/**
 * Structure-derived target ladder.
 *
 * TP1 is the nearest opposing liquidity level ahead of the entry (a prior
 * swing high for a long, a prior swing low for a short); TP2 and TP3 are the
 * next structural levels out. Levels closer together than a quarter of ATR
 * describe the same pocket of liquidity and collapse into one. A level is only
 * usable when it pays at least `minRr` and sits inside `maxRr` — beyond that
 * the level is not a realistic destination for the setup's timeframe.
 *
 * When structure does not supply enough usable levels the ladder is topped up
 * from the fixed R-multiple fallback, so a setup always has a complete plan.
 * Nothing here decides whether the trade should be taken.
 */
export function structuralTargets(params: {
  entry: number;
  stop: number;
  direction: "LONG" | "SHORT";
  /** Candidate structural levels (swing highs for longs, lows for shorts). */
  levels: number[];
  atr: number | null;
  minRr?: number;
  maxRr?: number;
  count?: number;
  fallbackMultiples?: number[];
}): number[] {
  const {
    entry,
    stop,
    direction,
    levels,
    atr,
    minRr = 1.2,
    maxRr = 6,
    count = 3,
    fallbackMultiples = [2, 3, 4],
  } = params;

  const r = Math.abs(entry - stop);
  if (!(r > 0)) return [];
  const sign = direction === "LONG" ? 1 : -1;
  const merge = atr && atr > 0 ? atr * 0.25 : r * 0.1;

  const usable: number[] = [];
  const sorted = levels
    .filter((level) => Number.isFinite(level))
    .map((level) => ({ level, reward: (level - entry) * sign }))
    .filter(({ reward }) => reward / r >= minRr && reward / r <= maxRr)
    .sort((a, b) => a.reward - b.reward);

  for (const { level } of sorted) {
    if (usable.length >= count) break;
    const last = usable[usable.length - 1];
    if (last !== undefined && Math.abs(level - last) < merge) continue;
    usable.push(level);
  }

  if (usable.length >= count) return usable;

  // Top up from the R-multiple ladder, keeping the ladder strictly increasing.
  const lastRr =
    usable.length > 0 ? Math.abs(usable[usable.length - 1] - entry) / r : 0;
  for (const multiple of fallbackMultiples) {
    if (usable.length >= count) break;
    if (multiple <= lastRr + 0.1) continue;
    usable.push(entry + sign * r * multiple);
  }

  return usable;
}
