import { describe, expect, it } from "vitest";
import { normaliseCandles } from "@/lib/ptrades/scanner/candles.server";
import type { Candle } from "@/lib/ptrades/scanner/types";
import clean from "../../../../../fixtures/candles/xauusd-m5-clean.json";
import malformed from "../../../../../fixtures/candles/xauusd-m5-malformed.json";
import expected from "../../../../../fixtures/expected/normalisation.json";

/**
 * Parity layer: these are the same fixtures and the same expectations the
 * Python reference package asserts against.
 */

const FIXTURES: Record<string, { candles: unknown[] }> = {
  "xauusd-m5-clean.json": clean,
  "xauusd-m5-malformed.json": malformed,
};

const NOW = Date.parse(expected.now);

describe("shared fixture parity — candle normalisation", () => {
  for (const testCase of expected.cases) {
    it(`${testCase.fixture} keeps ${testCase.kept} candles`, () => {
      const fixture = FIXTURES[testCase.fixture];
      const result = normaliseCandles(fixture.candles as Candle[], "M5", NOW);
      expect(result.candles).toHaveLength(testCase.kept);
      const reasons = [...new Set(result.rejected.map((r) => r.reason))].sort();
      expect(reasons).toEqual([...testCase.reject_reasons].sort());
    });
  }

  it("never repairs or interpolates a malformed candle", () => {
    const result = normaliseCandles(malformed.candles as Candle[], "M5", NOW);
    for (const c of result.candles) {
      expect(c.high).toBeGreaterThanOrEqual(c.low);
      expect(c.open).toBeLessThanOrEqual(c.high);
      expect(c.close).toBeGreaterThanOrEqual(c.low);
    }
  });

  it("keeps candles in ascending time order", () => {
    const result = normaliseCandles(clean.candles as Candle[], "M5", NOW);
    const times = result.candles.map((c) => Date.parse(c.time));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
