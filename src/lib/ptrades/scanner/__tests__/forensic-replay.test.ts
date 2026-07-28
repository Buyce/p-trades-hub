import { describe, expect, it } from "vitest";
import { detectNewMicroTrigger } from "@/lib/ptrades/scanner/micro-trigger.server";
import { evaluateBiasPolicy } from "@/lib/ptrades/scanner/bias-policy.server";
import { structuralIdeaId } from "@/lib/ptrades/scanner/structural-idea";
import { validateSequence } from "@/lib/ptrades/scanner/setups.server";
import { DEFAULT_PRECISION, DEFAULT_RULEBOOK } from "@/lib/ptrades/scanner/types";
import { validateRulebook } from "@/lib/ptrades/scanner/rulebook-validate";
import { isStoreFresh, seriesAgeSeconds } from "@/lib/ptrades/scanner/market-candles.server";
import { candle, MINUTE } from "./fixtures";

/**
 * Deterministic forensic replay.
 *
 * The production failures were never single-function bugs — they were an
 * end-to-end lifecycle that stalled. This file replays that lifecycle with
 * fixed inputs and no clock reads, so each repaired stage is pinned:
 *
 *   chronology -> bias eligibility -> idea identity -> M1 trigger -> freshness
 *
 * A regression in any one of them puts the pipeline back to zero alerts, which
 * is exactly the state this suite exists to prevent.
 */

const LONG = "LONG" as const;

function m1(closes: Array<{ o: number; h: number; l: number; c: number }>) {
  return closes.map((k, i) => candle(i, { open: k.o, high: k.h, low: k.l, close: k.c }, MINUTE));
}

describe("forensic replay: chronology", () => {
  it("rejects a retest that happens before the break", () => {
    expect(
      validateSequence({
        sweepIndex: 1,
        displacementIndex: 5,
        structureIndex: 8,
        retestIndex: 6,
      } as never),
    ).toBe(false);
  });

  it("accepts a strictly ordered sweep -> displacement -> break -> retest", () => {
    expect(
      validateSequence({
        sweepIndex: 1,
        displacementIndex: 5,
        structureIndex: 8,
        retestIndex: 11,
      } as never),
    ).toBe(true);
  });
});

describe("forensic replay: bias eligibility", () => {
  const setup = {
    setupType: "SWEEP_DISPLACEMENT_RETEST",
    sweepFound: true,
    structureType: "BOS" as const,
    direction: LONG,
  };

  it("allows a counter-bias sweep reversal instead of killing it", () => {
    const decision = evaluateBiasPolicy({
      setup,
      direction: LONG,
      bias: "SHORT",
      d1: "SHORT",
    });
    expect(decision.policy).toBe("REVERSAL_ALLOWED");
    expect(decision.passed).toBe(true);
    // Counter-bias must never be scored as if it were aligned.
    expect(decision.aligned).toBe(false);
  });

  it("still blocks a counter-bias continuation", () => {
    const decision = evaluateBiasPolicy({
      setup: { ...setup, setupType: "PULLBACK_CONTINUATION", sweepFound: false },
      direction: LONG,
      bias: "SHORT",
      d1: "SHORT",
    });
    expect(decision.policy).toBe("COUNTER_TREND_BLOCKED");
    expect(decision.passed).toBe(false);
  });
});

describe("forensic replay: structural idea identity", () => {
  it("treats two families off the same level as one idea", () => {
    const args = { instrument: "XAUUSD", direction: LONG, atr: 4, tradingDayUtc: "2026-01-05" };
    expect(structuralIdeaId({ ...args, level: 2000.0 })).toBe(
      structuralIdeaId({ ...args, level: 2000.4 }),
    );
  });

  it("separates ideas built on genuinely different levels", () => {
    const args = { instrument: "XAUUSD", direction: LONG, atr: 4, tradingDayUtc: "2026-01-05" };
    expect(structuralIdeaId({ ...args, level: 2000 })).not.toBe(
      structuralIdeaId({ ...args, level: 2030 }),
    );
  });
});

describe("forensic replay: M1 execution trigger", () => {
  // Rejection into the zone, a displacement leg up, a break, then a retest.
  const series = m1([
    { o: 100.0, h: 100.2, l: 99.6, c: 99.8 },
    { o: 99.8, h: 100.0, l: 99.5, c: 99.7 },
    { o: 99.7, h: 99.9, l: 99.4, c: 99.6 },
    { o: 99.6, h: 101.2, l: 99.55, c: 101.1 },
    { o: 101.1, h: 101.6, l: 101.0, c: 101.5 },
    { o: 101.5, h: 101.7, l: 101.0, c: 101.1 },
    { o: 101.1, h: 101.9, l: 101.05, c: 101.8 },
  ]);

  it("fires only on the closed rejection -> displacement -> break sequence", () => {
    const trigger = detectNewMicroTrigger({
      candles: series,
      direction: LONG,
      zoneLow: 99.4,
      zoneHigh: 99.9,
      atrM1: 0.4,
      displacementMinAtr: DEFAULT_PRECISION.displacement_m1_min_atr,
      retestWithinBars: 3,
    });
    expect(trigger.triggered).toBe(true);
    expect(trigger.displacementCandleTime).not.toBeNull();
  });

  it("does not fire when price never left the zone", () => {
    const flatSeries = m1(
      Array.from({ length: 7 }, () => ({ o: 99.7, h: 99.8, l: 99.6, c: 99.7 })),
    );
    const trigger = detectNewMicroTrigger({
      candles: flatSeries,
      direction: LONG,
      zoneLow: 99.4,
      zoneHigh: 99.9,
      atrM1: 0.4,
      displacementMinAtr: DEFAULT_PRECISION.displacement_m1_min_atr,
      retestWithinBars: 3,
    });
    expect(trigger.triggered).toBe(false);
    expect(trigger.failures.length).toBeGreaterThan(0);
  });

  it("keeps the M1 displacement threshold independent of the M15 one", () => {
    // Regression guard: it used to be min(1, displacement_min_atr), so tuning
    // structural detection silently retuned execution timing.
    const validation = validateRulebook({
      ...DEFAULT_RULEBOOK,
      displacement_min_atr: 0.2,
    });
    expect(validation.rulebook.precision.displacement_m1_min_atr).toBe(
      DEFAULT_PRECISION.displacement_m1_min_atr,
    );
    expect(validation.issues).toEqual([]);
  });
});

describe("forensic replay: durable data plane freshness", () => {
  const series = m1([
    { o: 100, h: 100.5, l: 99.5, c: 100 },
    { o: 100, h: 100.5, l: 99.5, c: 100.2 },
  ]);
  const lastCloseMs = Date.parse(series[1].time) + MINUTE;

  it("measures age from the close of the last candle", () => {
    expect(seriesAgeSeconds(series, "1m", lastCloseMs)).toBe(0);
    expect(seriesAgeSeconds(series, "1m", lastCloseMs + 90_000)).toBe(90);
  });

  it("allows one full interval on top of the feed budget", () => {
    // A 15m series is necessarily up to one interval old before the next bar
    // closes; treating that as stale is what blocked every scan.
    expect(isStoreFresh(15 * 60, "15m", 120)).toBe(true);
    expect(isStoreFresh(15 * 60 + 121, "15m", 120)).toBe(false);
  });
});
