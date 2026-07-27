import { describe, expect, it } from "vitest";
import { matchBrokerSymbol, roundToDigits } from "../symbols.server";

describe("matchBrokerSymbol", () => {
  it("prefers an exact match", () => {
    expect(matchBrokerSymbol("XAUUSD", ["XAUUSD.m", "XAUUSD"])).toBe("XAUUSD");
  });

  it("ignores punctuation and case when comparing", () => {
    expect(matchBrokerSymbol("xauusd", ["XAU/USD"])).toBe("XAU/USD");
  });

  it("falls back to the shortest suffixed variant", () => {
    expect(matchBrokerSymbol("XAUUSD", ["XAUUSD.micro.raw", "XAUUSD.m"])).toBe("XAUUSD.m");
  });

  it("returns null when nothing matches", () => {
    expect(matchBrokerSymbol("XAUUSD", ["EURUSD", "GBPUSD"])).toBeNull();
  });
});

describe("roundToDigits", () => {
  it("rounds to the instrument precision", () => {
    expect(roundToDigits(1.234567, 5)).toBe(1.23457);
    expect(roundToDigits(2345.678, 2)).toBe(2345.68);
  });

  it("passes values through when digits are unknown", () => {
    expect(roundToDigits(1.234567, null)).toBe(1.234567);
  });

  it("returns null for missing values", () => {
    expect(roundToDigits(null, 5)).toBeNull();
  });
});
