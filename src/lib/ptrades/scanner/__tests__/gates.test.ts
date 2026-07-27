import { describe, expect, it } from "vitest";
import {
  allPassed,
  biasConflict,
  dailyCap,
  duplicate,
  failedGates,
  gate,
  invalidStop,
  lateEntry,
  missingData,
  newsLockout,
  rrGate,
  spreadGate,
  staleData,
} from "../gates.server";

/**
 * Spec: apply_hard_gates rejects on stale tick, wide spread, daily limit, news
 * lockout, late entry, invalid risk, missing targets and sub-minimum R:R.
 *
 * Two rules hold for EVERY gate:
 *  - it stores a plain-English reason on both the pass and fail branch;
 *  - it fails closed, so missing or ambiguous input is a rejection.
 */

function expectReason(result: { reason: string }) {
  expect(result.reason.length).toBeGreaterThan(10);
}

describe("gate reasons", () => {
  it("records a readable reason on every branch", () => {
    const results = [
      missingData(true, {}),
      missingData(false, {}),
      staleData(10, 300),
      staleData(900, 300),
      staleData(null, 300),
      spreadGate(0.1, 10, 0.15, null),
      spreadGate(5, 10, 0.15, null),
      spreadGate(null, 10, 0.15, null),
      newsLockout(false, []),
      newsLockout(true, ["US CPI"]),
      biasConflict("LONG", "LONG"),
      biasConflict("SHORT", "LONG"),
      invalidStop(100, 95, "LONG", 10),
      invalidStop(100, 105, "LONG", 10),
      rrGate(2.5, 2),
      rrGate(1.2, 2),
      rrGate(null, 2),
      lateEntry(false, 0.1),
      lateEntry(true, 1.4),
      duplicate(false, "abc"),
      duplicate(true, "abc"),
      dailyCap(0, 2),
      dailyCap(2, 2),
    ];
    results.forEach(expectReason);
  });
});

describe("staleData", () => {
  it("passes fresh data and rejects data past the limit", () => {
    expect(staleData(299, 300).passed).toBe(true);
    expect(staleData(300, 300).passed).toBe(true);
    expect(staleData(301, 300).passed).toBe(false);
  });

  it("fails closed when there is no candle at all", () => {
    expect(staleData(null, 300).passed).toBe(false);
  });
});

describe("spreadGate", () => {
  it("passes a spread within the ATR ratio", () => {
    expect(spreadGate(1, 10, 0.15, null).passed).toBe(true);
  });

  it("rejects a spread above the ATR ratio", () => {
    expect(spreadGate(2, 10, 0.15, null).passed).toBe(false);
  });

  it("rejects a spread above the instrument's absolute limit first", () => {
    const result = spreadGate(3, 1000, 0.15, 2);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("instrument limit");
  });

  it("fails closed when spread or ATR is unavailable", () => {
    expect(spreadGate(null, 10, 0.15, null).passed).toBe(false);
    expect(spreadGate(1, null, 0.15, null).passed).toBe(false);
    expect(spreadGate(1, 0, 0.15, null).passed).toBe(false);
  });
});

describe("newsLockout", () => {
  it("rejects inside a high-impact lockout window and names the events", () => {
    const result = newsLockout(true, ["US CPI", "FOMC"]);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("US CPI");
  });

  it("passes when no lockout is active", () => {
    expect(newsLockout(false, []).passed).toBe(true);
  });
});

describe("biasConflict", () => {
  it("passes only when higher-timeframe bias matches the direction", () => {
    expect(biasConflict("LONG", "LONG").passed).toBe(true);
    expect(biasConflict("SHORT", "LONG").passed).toBe(false);
    expect(biasConflict("NEUTRAL", "LONG").passed).toBe(false);
  });
});

describe("invalidStop", () => {
  it("passes a stop beyond structure on the correct side", () => {
    expect(invalidStop(100, 95, "LONG", 10).passed).toBe(true);
    expect(invalidStop(100, 105, "SHORT", 10).passed).toBe(true);
  });

  it("rejects a stop on the wrong side of entry", () => {
    expect(invalidStop(100, 105, "LONG", 10).passed).toBe(false);
    expect(invalidStop(100, 95, "SHORT", 10).passed).toBe(false);
  });

  it("rejects a zero-distance stop", () => {
    expect(invalidStop(100, 100, "LONG", 10).passed).toBe(false);
  });

  it("rejects a stop wider than 4x ATR as undefinable risk", () => {
    expect(invalidStop(100, 59, "LONG", 10).passed).toBe(false);
    expect(invalidStop(100, 61, "LONG", 10).passed).toBe(true);
  });

  it("fails closed when entry or stop is missing", () => {
    expect(invalidStop(null, 95, "LONG", 10).passed).toBe(false);
    expect(invalidStop(100, null, "LONG", 10).passed).toBe(false);
  });
});

describe("rrGate", () => {
  it("enforces the 2.0R minimum at TP1", () => {
    expect(rrGate(2, 2).passed).toBe(true);
    expect(rrGate(1.99, 2).passed).toBe(false);
    expect(rrGate(3.4, 2).passed).toBe(true);
  });

  it("respects a stricter per-instrument minimum", () => {
    expect(rrGate(2.2, 2.5).passed).toBe(false);
  });

  it("fails closed when R:R cannot be computed — the missing-target case", () => {
    expect(rrGate(null, 2).passed).toBe(false);
  });
});

describe("lateEntry", () => {
  it("rejects once price has run beyond the entry zone", () => {
    expect(lateEntry(true, 1.2).passed).toBe(false);
    expect(lateEntry(false, 0.2).passed).toBe(true);
  });
});

describe("duplicate", () => {
  it("rejects a setup already recorded for the UTC day", () => {
    expect(duplicate(true, "abc").passed).toBe(false);
    expect(duplicate(false, "abc").passed).toBe(true);
  });
});

describe("dailyCap", () => {
  it("allows the first two actionable alerts of the UTC day", () => {
    expect(dailyCap(0, 2).passed).toBe(true);
    expect(dailyCap(1, 2).passed).toBe(true);
  });

  it("rejects the third", () => {
    expect(dailyCap(2, 2).passed).toBe(false);
    expect(dailyCap(3, 2).passed).toBe(false);
  });
});

describe("aggregation", () => {
  const pass = gate("MISSING_DATA", true, "All required timeframes returned candles.");
  const fail = gate("RR_BELOW_MIN", false, "Reward-to-risk is below the minimum.");

  it("allPassed is true only when no gate failed", () => {
    expect(allPassed([pass, pass])).toBe(true);
    expect(allPassed([pass, fail])).toBe(false);
    expect(allPassed([])).toBe(true);
  });

  it("failedGates returns exactly the failures, preserving their reasons", () => {
    const failures = failedGates([pass, fail, pass]);
    expect(failures).toHaveLength(1);
    expect(failures[0].code).toBe("RR_BELOW_MIN");
    expect(failures[0].reason).toBe("Reward-to-risk is below the minimum.");
  });
});
