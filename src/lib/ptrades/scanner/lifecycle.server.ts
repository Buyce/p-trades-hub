/**
 * Setup lifecycle state machine.
 *
 * The whole point of the precision engine is that "a setup exists" and "this is
 * the moment to execute" are different facts. This module owns that
 * distinction: a setup walks DETECTED → ARMED → MICRO_TRIGGERED → ENTRY_READY,
 * and only the final state may ever produce an alert. Every other outcome is a
 * terminal record kept for calibration.
 */

import type { SetupLifecycleState } from "./types";

export const TERMINAL_STATES: SetupLifecycleState[] = ["MISSED", "EXPIRED", "INVALIDATED"];

/** Legal transitions. Anything not listed here is a bug, not a state change. */
const TRANSITIONS: Record<SetupLifecycleState, SetupLifecycleState[]> = {
  DETECTED: ["ARMED", "EXPIRED", "INVALIDATED", "MISSED"],
  ARMED: ["MICRO_TRIGGERED", "MISSED", "EXPIRED", "INVALIDATED"],
  // A trigger whose retest never arrives falls back to ARMED: the setup is
  // still valid, only this attempt at the entry failed.
  MICRO_TRIGGERED: ["ENTRY_READY", "ARMED", "MISSED", "EXPIRED", "INVALIDATED"],
  ENTRY_READY: ["EXPIRED", "INVALIDATED", "MISSED"],
  MISSED: [],
  EXPIRED: [],
  INVALIDATED: [],
};

export function canTransition(
  from: SetupLifecycleState,
  to: SetupLifecycleState,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Applies a transition, or throws — an illegal state change must be loud. */
export function transition(
  from: SetupLifecycleState,
  to: SetupLifecycleState,
): SetupLifecycleState {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal lifecycle transition ${from} -> ${to}`);
  }
  return to;
}

export function isTerminal(state: SetupLifecycleState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Only ENTRY_READY is ever allowed to alert. */
export function isAlertable(state: SetupLifecycleState): boolean {
  return state === "ENTRY_READY";
}

/** True when the watch has run past its deadline. */
export function isExpired(expiresAtIso: string, now = Date.now()): boolean {
  const ms = Date.parse(expiresAtIso);
  return Number.isNaN(ms) ? true : ms <= now;
}

/** Deadline for a freshly armed setup. */
export function armedExpiry(armedAt: Date, minutes: number): string {
  return new Date(armedAt.getTime() + Math.max(1, minutes) * 60_000).toISOString();
}

/**
 * Deadline for a micro trigger to produce its retest, expressed in closed M1
 * candles rather than wall-clock minutes.
 */
export function triggerExpiry(triggeredAt: Date, bars: number, barSeconds = 60): string {
  return new Date(triggeredAt.getTime() + Math.max(1, bars) * barSeconds * 1000).toISOString();
}
