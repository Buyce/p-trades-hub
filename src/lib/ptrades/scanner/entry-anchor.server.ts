/**
 * Entry anchor: the exact price a setup wants to be entered at.
 *
 * The M15 setup produces a broken structural level; the anchor is the price on
 * that level the trade is actually planned from. There is exactly one anchor
 * per setup family, and no anchor is ever invented — when the setup did not
 * supply a usable level, the anchor is null and the candidate is rejected by
 * the invalidation/entry gates rather than alerted with a guess.
 */

import type { Candle } from "./types";
import type { SetupResult } from "./setups.server";

export type EntryAnchorSource =
  | "MICRO_BOS_LEVEL"
  | "BROKEN_STRUCTURE_LEVEL"
  | "RETEST_LEVEL"
  | "SWEEP_REJECTION_LEVEL";

export type EntryAnchorResult = {
  anchor: number | null;
  source: EntryAnchorSource | null;
  sourceCandleTime: string | null;
};

const NONE: EntryAnchorResult = { anchor: null, source: null, sourceCandleTime: null };

/**
 * Anchor for an M15 setup.
 *
 *  - Liquidity sweep reversal: the reclaimed level the sweep rejected from.
 *  - Break/retest continuation: the exact broken structural level.
 *  - Pullback continuation: the broken structural level the pullback returns to.
 */
export function entryAnchorForSetup(
  setup: SetupResult,
  candles: Candle[],
): EntryAnchorResult {
  if (setup.level === null || !Number.isFinite(setup.level)) return NONE;
  const at =
    (setup.detail.retestAt as string | undefined) ??
    (setup.detail.brokeAt as string | undefined) ??
    (setup.detail.sweptAt as string | undefined) ??
    candles.at(-1)?.time ??
    null;

  const source: EntryAnchorSource =
    setup.setupType === "SWEEP_DISPLACEMENT_RETEST"
      ? "SWEEP_REJECTION_LEVEL"
      : "BROKEN_STRUCTURE_LEVEL";

  return { anchor: setup.level, source, sourceCandleTime: at };
}

/**
 * Anchor refined by the micro trigger. Once a closed M1 candle has broken a
 * protected micro swing, that broken micro level — not the M15 level — is the
 * price the execution is planned from.
 */
export function microEntryAnchor(
  brokenLevel: number | null | undefined,
  candleTime: string | null | undefined,
  fallback: EntryAnchorResult,
): EntryAnchorResult {
  if (brokenLevel === null || brokenLevel === undefined || !Number.isFinite(brokenLevel)) {
    return fallback;
  }
  return {
    anchor: brokenLevel,
    source: "MICRO_BOS_LEVEL",
    sourceCandleTime: candleTime ?? fallback.sourceCandleTime,
  };
}
