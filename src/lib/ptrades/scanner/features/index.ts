/**
 * Feature engine — the one entry point for every deterministic market
 * calculation the scanner performs.
 *
 * There is exactly one implementation of each feature; this barrel names them
 * with the specification's vocabulary and re-exports the single source. Import
 * features from here, not from the individual modules, so a duplicate
 * implementation has nowhere to hide.
 *
 * Nothing here reads the network, the database, secrets or the clock: every
 * function is pure over closed candles, which is what makes TypeScript/Python
 * parity testable against the golden fixtures.
 */

export { trueRange, atr, type AtrMethod } from "../atr.server";
export { swingHighs, swingLows, lastSwing } from "../swings.server";
export { detectStructureEvent, type StructureEvent } from "../structure.server";
export { detectSweep } from "../sweep.server";
export { detectDisplacement } from "../displacement.server";
export { detectRetest } from "../retest.server";
export { higherTimeframeBias } from "../bias.server";
export { rewardToRisk, targetsFrom } from "../risk.server";
export { checkLateEntry } from "../late-entry.server";
export { sessionAt } from "../sessions.server";
export { checkCandleSanity } from "../sanity.server";
export {
  normaliseCandles,
  closedCandlesOnly,
  lastClosed,
  dataAgeSeconds,
  type CandleReject,
  type NormalisedCandles,
} from "../candles.server";

/* Precision entry engine — execution timing, kept in the same barrel so a
 * duplicate implementation has nowhere to hide. */
export { getPipSize, priceDistanceToPips, priceDistanceToPoints, pointsToPrice, pointSizeFor } from "../pips.server";
export {
  isPriceNearEntry,
  distanceToEntryPoints,
  calculateExtensionR,
  targetAlreadyTouched,
} from "../proximity.server";
export { entryAnchorForSetup, microEntryAnchor } from "../entry-anchor.server";
export { calculateAdaptiveZoneWidthPoints, buildExecutionZone } from "../entry-zone.server";
export { detectMicroTrigger, type MicroTriggerResult } from "../micro-trigger.server";
export { buildInvalidation, hasInvalidation, isInvalidated } from "../invalidation.server";
export { canTransition, transition, isAlertable, isTerminal, armedExpiry, triggerExpiry } from "../lifecycle.server";
