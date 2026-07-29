import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULEBOOK,
  SETUP_FAMILIES,
  SETUP_FAMILY_LABEL,
  normaliseSetupFamily,
} from "@/lib/ptrades/scanner/types";

describe("rulebook-driven feature settings", () => {
  it("defaults to the tuned live values, not the reference spec values", () => {
    expect(DEFAULT_RULEBOOK.atr_method).toBe("WILDER");
    expect(DEFAULT_RULEBOOK.atr_period).toBe(14);
    expect(DEFAULT_RULEBOOK.swing_lookback).toBe(5);
  });

  it("keeps the locked grade bands and minimum R:R", () => {
    expect(DEFAULT_RULEBOOK.grades).toEqual({ A_PLUS: 95, A: 90, B: 80, C: 70 });
    expect(DEFAULT_RULEBOOK.min_rr_tp1).toBe(2);
    expect(DEFAULT_RULEBOOK.tier_min_rr).toEqual({ A_PLUS: 2, A: 2, B: 1.5, C: 1.2 });
    // There is no daily cap anywhere in the rulebook.
    expect(DEFAULT_RULEBOOK as Record<string, unknown>).not.toHaveProperty(
      "max_daily_actionable",
    );
    expect(DEFAULT_RULEBOOK as Record<string, unknown>).not.toHaveProperty("tier_daily_max");
  });
});

describe("setup family registry", () => {
  it("labels every family", () => {
    for (const family of SETUP_FAMILIES) {
      expect(SETUP_FAMILY_LABEL[family]).toBeTruthy();
    }
  });

  it("maps the specification names onto the stored internal codes", () => {
    expect(normaliseSetupFamily("LIQUIDITY_SWEEP_REVERSAL")).toBe("SWEEP_DISPLACEMENT_RETEST");
    expect(normaliseSetupFamily("BREAKOUT_RETEST_CONTINUATION")).toBe("BREAK_RETEST");
    expect(normaliseSetupFamily("SUPPORT_BREAK_RETEST")).toBe("BREAK_RETEST");
    expect(normaliseSetupFamily("BEARISH_PULLBACK_CONTINUATION")).toBe("PULLBACK_CONTINUATION");
  });

  it("round-trips the internal codes and is case-insensitive", () => {
    for (const family of SETUP_FAMILIES) {
      expect(normaliseSetupFamily(family)).toBe(family);
      expect(normaliseSetupFamily(family.toLowerCase())).toBe(family);
    }
  });

  it("returns null for an unknown family rather than guessing", () => {
    expect(normaliseSetupFamily("MARTINGALE")).toBeNull();
    expect(normaliseSetupFamily(null)).toBeNull();
  });
});
