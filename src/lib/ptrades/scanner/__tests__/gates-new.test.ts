import { describe, expect, it } from "vitest";
import { candleSanity, expiry, noSetup, sessionGate } from "../gates.server";

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);

describe("sessionGate", () => {
  it("passes inside an allowed session", () => {
    const g = sessionGate("LONDON", ["LONDON", "NEWYORK"]);
    expect(g.passed).toBe(true);
    expect(g.reason).toMatch(/LONDON/);
  });

  it("fails outside the allowed sessions with a stored reason", () => {
    const g = sessionGate("ASIA", ["LONDON"]);
    expect(g.passed).toBe(false);
    expect(g.reason).toMatch(/outside the allowed sessions/);
  });

  it("fails when the market is closed", () => {
    expect(sessionGate("CLOSED", []).passed).toBe(false);
  });

  it("passes any open session when no list is configured", () => {
    expect(sessionGate("ASIA", []).passed).toBe(true);
  });
});

describe("candleSanity", () => {
  it("passes clean data", () => {
    expect(candleSanity(true, []).passed).toBe(true);
  });

  it("fails and reports the problems", () => {
    const g = candleSanity(false, ["High below low at T."]);
    expect(g.passed).toBe(false);
    expect(g.reason).toMatch(/High below low/);
  });
});

describe("expiry", () => {
  it("fails without a trigger time (fail closed)", () => {
    expect(expiry(null, 60, NOW).passed).toBe(false);
  });

  it("passes inside the validity window", () => {
    expect(expiry(new Date(NOW - 10 * 60_000).toISOString(), 60, NOW).passed).toBe(true);
  });

  it("fails once the setup is older than the window", () => {
    const g = expiry(new Date(NOW - 120 * 60_000).toISOString(), 60, NOW);
    expect(g.passed).toBe(false);
    expect(g.reason).toMatch(/expired/i);
  });

  it("fails on a future trigger time", () => {
    expect(expiry(new Date(NOW + 60_000).toISOString(), 60, NOW).passed).toBe(false);
  });
});

describe("noSetup", () => {
  it("passes when a family completed", () => {
    expect(noSetup(true, "BREAK_RETEST", {}).passed).toBe(true);
  });

  it("fails with a plain-English reason", () => {
    expect(noSetup(false, "BREAK_RETEST", {}).reason).toMatch(/No setup family/);
  });
});
