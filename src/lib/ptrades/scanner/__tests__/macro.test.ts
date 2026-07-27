import { describe, expect, it } from "vitest";
import { affectsSymbol, currenciesFor, macroContextFor, type MacroEvent } from "../macro.server";

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);

function event(partial: Partial<MacroEvent>): MacroEvent {
  return {
    title: "CPI",
    currency: "USD",
    impact: "HIGH",
    event_time_utc: new Date(NOW).toISOString(),
    lockout_start_utc: new Date(NOW - 15 * 60_000).toISOString(),
    lockout_end_utc: new Date(NOW + 15 * 60_000).toISOString(),
    symbols: [],
    ...partial,
  };
}

describe("currenciesFor", () => {
  it("uses stored base/quote when present", () => {
    expect(currenciesFor("XAUUSD", "XAU", "USD")).toEqual(["XAU", "USD"]);
  });

  it("derives currencies from a six-letter symbol", () => {
    expect(currenciesFor("GBPAUD", null, null)).toEqual(["GBP", "AUD"]);
  });
});

describe("affectsSymbol", () => {
  it("matches by currency", () => {
    expect(affectsSymbol(event({}), "EURUSD", ["EUR", "USD"])).toBe(true);
    expect(affectsSymbol(event({}), "GBPAUD", ["GBP", "AUD"])).toBe(false);
  });

  it("prefers an explicit symbol list", () => {
    const e = event({ currency: "USD", symbols: ["GBPAUD"] });
    expect(affectsSymbol(e, "GBPAUD", ["GBP", "AUD"])).toBe(true);
    expect(affectsSymbol(e, "EURUSD", ["EUR", "USD"])).toBe(false);
  });

  it("treats an event with no currency as global", () => {
    expect(affectsSymbol(event({ currency: null }), "GBPAUD", ["GBP", "AUD"])).toBe(true);
  });
});

describe("macroContextFor", () => {
  it("locks only instruments touched by the event", () => {
    const events = [event({})];
    expect(macroContextFor(events, "EURUSD", ["EUR", "USD"], NOW).locked).toBe(true);
    expect(macroContextFor(events, "GBPAUD", ["GBP", "AUD"], NOW).locked).toBe(false);
  });

  it("ignores non high-impact events", () => {
    const ctx = macroContextFor([event({ impact: "LOW" })], "EURUSD", ["EUR", "USD"], NOW);
    expect(ctx.locked).toBe(false);
    expect(ctx.aligned).toBe(true);
  });

  it("flags an upcoming event inside the lookahead as not aligned", () => {
    const soon = event({
      event_time_utc: new Date(NOW + 30 * 60_000).toISOString(),
      lockout_start_utc: new Date(NOW + 15 * 60_000).toISOString(),
      lockout_end_utc: new Date(NOW + 45 * 60_000).toISOString(),
    });
    const ctx = macroContextFor([soon], "EURUSD", ["EUR", "USD"], NOW, 60);
    expect(ctx.locked).toBe(false);
    expect(ctx.aligned).toBe(false);
    expect(ctx.upcoming).toHaveLength(1);
  });

  it("is aligned when the runway is clear", () => {
    expect(macroContextFor([], "EURUSD", ["EUR", "USD"], NOW).aligned).toBe(true);
  });
});
