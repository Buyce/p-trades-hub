import { describe, expect, it } from "vitest";
import { atr, rewardToRisk, swingHighs, swingLows, trueRange } from "@/lib/ptrades/scanner/features";
import type { Candle } from "@/lib/ptrades/scanner/types";
import clean from "../../../../../../fixtures/candles/xauusd-m5-clean.json";
import zigzag from "../../../../../../fixtures/golden/xauusd-m15-zigzag.json";
import golden from "../../../../../../fixtures/golden/features.json";

/**
 * Golden feature parity. These same numbers are asserted by the Python
 * reference engine, so a change to either implementation fails a test here.
 */

const CANDLES: Record<string, Candle[]> = {
  "xauusd-m5-clean": clean.candles as Candle[],
  "xauusd-m15-zigzag": zigzag.candles as Candle[],
};

const TOL = golden.tolerance;

describe("golden feature parity", () => {
  for (const [name, expected] of Object.entries(golden.sources)) {
    const candles = CANDLES[name];

    describe(name, () => {
      it("has the expected candle count", () => {
        expect(candles).toHaveLength(expected.candle_count);
      });

      it("reproduces true range", () => {
        const trs = trueRange(candles);
        expect(trs).toHaveLength(expected.true_range.count);
        trs.slice(0, 5).forEach((v, i) => {
          expect(v).toBeCloseTo(expected.true_range.first_5[i], 9);
        });
        trs.slice(-5).forEach((v, i) => {
          expect(v).toBeCloseTo(expected.true_range.last_5[i], 9);
        });
      });

      it("reproduces ATR for both smoothing methods", () => {
        expect(atr(candles, 14, "WILDER")!).toBeCloseTo(expected.atr.wilder_14, 9);
        expect(atr(candles, 14, "SMA")!).toBeCloseTo(expected.atr.sma_14, 9);
        expect(atr(candles, 5, "WILDER")!).toBeCloseTo(expected.atr.wilder_5, 9);
        expect(atr(candles.slice(0, 10), 14, "WILDER")).toBeNull();
      });

      it("defaults to Wilder smoothing, matching live behaviour", () => {
        expect(atr(candles, 14)).toBe(atr(candles, 14, "WILDER"));
      });

      it("reproduces confirmed swings at lookback 5", () => {
        const highs = swingHighs(candles, 5);
        const lows = swingLows(candles, 5);
        expect(highs.map((s) => s.index)).toEqual(
          expected.swings.lookback_5.highs.map((s) => s.index),
        );
        expect(lows.map((s) => s.index)).toEqual(
          expected.swings.lookback_5.lows.map((s) => s.index),
        );
        highs.forEach((s, i) => {
          expect(s.price).toBeCloseTo(expected.swings.lookback_5.highs[i].price, 9);
          expect(s.time).toBe(expected.swings.lookback_5.highs[i].time);
        });
      });

      it("reproduces swing counts at lookback 3", () => {
        expect(swingHighs(candles, 3)).toHaveLength(expected.swings.lookback_3.high_count);
        expect(swingLows(candles, 3)).toHaveLength(expected.swings.lookback_3.low_count);
      });
    });
  }

  it("reproduces reward-to-risk, including the invalid cases", () => {
    for (const c of golden.reward_to_risk) {
      const actual = rewardToRisk(c.entry, c.stop, c.target);
      if (c.rr === null) expect(actual).toBeNull();
      else expect(actual!).toBeCloseTo(c.rr, 9);
    }
  });

  it("uses a tolerance tight enough to catch a real drift", () => {
    expect(TOL).toBeLessThanOrEqual(1e-9);
  });
});
