import { describe, expect, it } from "vitest";
import { higherTimeframeBias } from "../bias.server";
import { candle } from "./fixtures";
import type { Candle } from "../types";

/**
 * Spec: simple_trend_bias returns BUY for higher-high/higher-low, SELL for
 * lower-high/lower-low, otherwise nothing. Here that is LONG / SHORT / NEUTRAL.
 */

function bars(rows: Array<[high: number, low: number]>) {
  return rows.map(([high, low], i) =>
    candle(i, { open: (high + low) / 2, high, low, close: (high + low) / 2 }),
  );
}

/** Higher highs at index 2 and 5, higher lows at index 1 and 4. */
const uptrend = bars([
  [10, 8],
  [9, 5],
  [15, 11],
  [12, 9],
  [11, 7],
  [20, 13],
  [14, 12],
]);

/** Mirror of the uptrend: lower highs and lower lows. */
const downtrend: Candle[] = uptrend.map((c, i) =>
  candle(i, { open: 30 - c.open, high: 30 - c.low, low: 30 - c.high, close: 30 - c.close }),
);

/** Not enough confirmed swings to establish structure. */
const choppy = bars([
  [10, 8],
  [10, 8],
  [10, 8],
  [10, 8],
  [10, 8],
]);

describe("higherTimeframeBias", () => {
  it("returns LONG for higher highs and higher lows", () => {
    expect(higherTimeframeBias(uptrend, uptrend, 1).bias).toBe("LONG");
  });

  it("returns SHORT for lower highs and lower lows", () => {
    expect(higherTimeframeBias(downtrend, downtrend, 1).bias).toBe("SHORT");
  });

  it("returns NEUTRAL when there are too few confirmed swings", () => {
    expect(higherTimeframeBias(choppy, choppy, 1).bias).toBe("NEUTRAL");
  });

  it("lets D1 arbitrate when H4 is neutral", () => {
    const result = higherTimeframeBias(choppy, uptrend, 1);
    expect(result).toMatchObject({ bias: "LONG", h4: "NEUTRAL", d1: "LONG" });
  });

  it("lets H4 stand when D1 is neutral", () => {
    const result = higherTimeframeBias(uptrend, choppy, 1);
    expect(result).toMatchObject({ bias: "LONG", h4: "LONG", d1: "NEUTRAL" });
  });

  it("is NEUTRAL — never a guess — when H4 and D1 disagree", () => {
    const result = higherTimeframeBias(uptrend, downtrend, 1);
    expect(result).toMatchObject({ bias: "NEUTRAL", h4: "LONG", d1: "SHORT" });
  });

  it("reports each timeframe separately for the dashboard", () => {
    const result = higherTimeframeBias(uptrend, uptrend, 1);
    expect(result.h4).toBe("LONG");
    expect(result.d1).toBe("LONG");
  });
});
