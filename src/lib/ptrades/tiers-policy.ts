/**
 * The single authority on which tiers may become actionable and when.
 *
 * Product policy: A+, A, B and C are ALL actionable tiers. Tier quality changes
 * the label, the score band and the reward-to-risk floor — never whether the
 * setup is allowed to alert. There is no daily alert cap: nothing in this file
 * counts anything.
 *
 * Every notification decision in the system flows through `isActionable`, so
 * there is exactly one place where "may this alert?" is answered.
 */

import type { Tier } from "./tiers";

export const ACTIONABLE_TIERS = ["A_PLUS", "A", "B", "C"] as const;

export type ActionableTier = (typeof ACTIONABLE_TIERS)[number];

export type SystemMode = "LIVE_ALERTS" | "SHADOW";

export function isActionableTier(value: unknown): value is ActionableTier {
  return ACTIONABLE_TIERS.includes(value as ActionableTier);
}

/** Every tier is actionable, so the default alert preference is all of them. */
export const DEFAULT_ALERT_TIERS: Tier[] = [...ACTIONABLE_TIERS];

/** Live alerts unless the scanner is explicitly running in shadow mode. */
export function systemModeFor(shadowMode: boolean): SystemMode {
  return shadowMode ? "SHADOW" : "LIVE_ALERTS";
}

export type ActionableInput = {
  grade: string | null;
  lifecycleState: string;
  hardGateFailures: string[];
  systemMode: SystemMode;
  notificationAlreadySent: boolean;
};

/**
 * The only actionable test in the codebase. Fails closed: an unknown tier, a
 * pre-ENTRY_READY state, any failed hard gate, shadow mode or an already-sent
 * notification all mean "no".
 */
export function isActionable(input: ActionableInput): boolean {
  return (
    input.systemMode === "LIVE_ALERTS" &&
    input.lifecycleState === "ENTRY_READY" &&
    isActionableTier(input.grade) &&
    input.hardGateFailures.length === 0 &&
    !input.notificationAlreadySent
  );
}

/** Delivery filter. Preferences change who receives it, never whether it fires. */
export function userWantsTier(preferred: readonly string[], grade: string | null): boolean {
  return isActionableTier(grade) && preferred.includes(grade);
}

/** Idempotency key for one delivery attempt. */
export function notificationKey(
  signalId: string,
  notificationType: string,
  userId: string,
  channel: string,
): string {
  return `${signalId}|${notificationType}|${userId}|${channel}`;
}
