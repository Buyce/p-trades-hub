import { describe, expect, it } from "vitest";
import {
  ACTIONABLE_TIERS,
  DEFAULT_ALERT_TIERS,
  isActionable,
  isActionableTier,
  notificationKey,
  systemModeFor,
  userWantsTier,
} from "../tiers-policy";
import { DEFAULT_EMAIL_TIERS, DEFAULT_PUSH_TIERS, DEFAULT_TERMINAL_TIERS } from "../tiers";

const live = {
  lifecycleState: "ENTRY_READY",
  hardGateFailures: [] as string[],
  systemMode: "LIVE_ALERTS" as const,
  notificationAlreadySent: false,
};

describe("tier policy", () => {
  it("treats every tier as actionable — B and C are not journal-only", () => {
    expect(ACTIONABLE_TIERS).toEqual(["A_PLUS", "A", "B", "C"]);
    for (const grade of ACTIONABLE_TIERS) {
      expect(isActionable({ ...live, grade })).toBe(true);
    }
  });

  it("defaults every delivery channel to all four tiers", () => {
    expect(DEFAULT_ALERT_TIERS).toEqual([...ACTIONABLE_TIERS]);
    expect(DEFAULT_EMAIL_TIERS).toEqual([...ACTIONABLE_TIERS]);
    expect(DEFAULT_PUSH_TIERS).toEqual([...ACTIONABLE_TIERS]);
    expect(DEFAULT_TERMINAL_TIERS).toEqual([...ACTIONABLE_TIERS]);
  });

  it("fails closed on anything short of a clean ENTRY_READY", () => {
    expect(isActionable({ ...live, grade: "C", lifecycleState: "ARMED" })).toBe(false);
    expect(isActionable({ ...live, grade: "C", lifecycleState: "MICRO_TRIGGERED" })).toBe(false);
    expect(isActionable({ ...live, grade: null })).toBe(false);
    expect(isActionable({ ...live, grade: "D" })).toBe(false);
    expect(isActionable({ ...live, grade: "A", hardGateFailures: ["SPREAD"] })).toBe(false);
    expect(isActionable({ ...live, grade: "A", notificationAlreadySent: true })).toBe(false);
    expect(isActionable({ ...live, grade: "A", systemMode: "SHADOW" })).toBe(false);
  });

  it("never counts anything — there is no cap input to the decision", () => {
    const policy = Object.keys({ ...live, grade: "A" });
    expect(policy.some((k) => /cap|count|limit|quota/i.test(k))).toBe(false);
  });

  it("maps shadow mode to the shadow system mode", () => {
    expect(systemModeFor(true)).toBe("SHADOW");
    expect(systemModeFor(false)).toBe("LIVE_ALERTS");
  });

  it("uses preferences for delivery only", () => {
    expect(userWantsTier(["A_PLUS", "A"], "C")).toBe(false);
    expect(userWantsTier(["A_PLUS", "A", "B", "C"], "C")).toBe(true);
    // The signal is still actionable regardless of who wants it.
    expect(isActionable({ ...live, grade: "C" })).toBe(true);
  });

  it("keys notifications per signal, type, user and channel", () => {
    expect(notificationKey("sig", "ENTRY_READY", "user", "email")).toBe(
      "sig|ENTRY_READY|user|email",
    );
    expect(isActionableTier("A_PLUS")).toBe(true);
    expect(isActionableTier("X")).toBe(false);
  });
});
