import { describe, expect, it } from "vitest";
import { detectNewMicroTrigger } from "@/lib/ptrades/scanner/micro-trigger.server";
import { evaluateBiasPolicy } from "@/lib/ptrades/scanner/bias-policy.server";
import { structuralIdeaId } from "@/lib/ptrades/scanner/structural-idea";
import { validateSequence } from "@/lib/ptrades/scanner/setups.server";
import { DEFAULT_PRECISION, DEFAULT_RULEBOOK } from "@/lib/ptrades/scanner/types";
import { validateRulebook } from "@/lib/ptrades/scanner/rulebook-validate";
import { isStoreFresh, seriesAgeSeconds } from "@/lib/ptrades/scanner/market-candles.server";
import {
  extremeSinceArmed,
  targetAlreadyTouched,
} from "@/lib/ptrades/scanner/proximity.server";
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
        breakIndex: 8,
        retestIndex: 6,
      }),
    ).toBe(false);
  });

  it("rejects a retest on the same candle as the break", () => {
    expect(
      validateSequence({
        sweepIndex: 1,
        displacementIndex: 5,
        breakIndex: 8,
        retestIndex: 8,
      }),
    ).toBe(false);
  });

  it("accepts a strictly ordered sweep -> displacement -> break -> retest", () => {
    expect(
      validateSequence({
        sweepIndex: 1,
        displacementIndex: 5,
        breakIndex: 8,
        retestIndex: 11,
      }),
    ).toBe(true);
  });
});

describe("forensic replay: bias eligibility", () => {
  const setup = {
    setupType: "SWEEP_DISPLACEMENT_RETEST" as const,
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
      setup: { ...setup, setupType: "PULLBACK_CONTINUATION" as const, sweepFound: false },
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
  // A micro swing high, a rejection back into the armed zone, a displacement
  // leg, a close through the swing, then a retest that holds it.
  const series = m1([
    { o: 100.0, h: 100.2, l: 99.9, c: 100.1 },
    { o: 100.1, h: 100.4, l: 100.0, c: 100.3 },
    { o: 100.3, h: 100.7, l: 100.2, c: 100.6 },
    { o: 100.6, h: 100.6, l: 100.1, c: 100.2 },
    { o: 100.2, h: 100.3, l: 99.7, c: 99.8 },
    { o: 99.8, h: 99.9, l: 99.4, c: 99.85 },
    { o: 99.85, h: 100.4, l: 99.8, c: 100.35 },
    { o: 100.35, h: 100.9, l: 100.3, c: 100.85 },
    { o: 100.85, h: 100.88, l: 100.6, c: 100.78 },
    { o: 100.78, h: 101.2, l: 100.7, c: 101.1 },
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
      Array.from({ length: 12 }, () => ({ o: 99.7, h: 99.8, l: 99.6, c: 99.7 })),
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
    expect(seriesAgeSeconds(series, "M1", lastCloseMs)).toBe(0);
    expect(seriesAgeSeconds(series, "M1", lastCloseMs + 90_000)).toBe(90);
  });

  it("allows one full interval on top of the feed budget", () => {
    // A 15m series is necessarily up to one interval old before the next bar
    // closes; treating that as stale is what blocked every scan.
    expect(isStoreFresh(15 * 60, "M15", 120)).toBe(true);
    expect(isStoreFresh(15 * 60 + 121, "M15", 120)).toBe(false);
  });
});

describe("forensic replay: the armed window for a missed move", () => {
  // Two hours of stored M1 history, but the watch was only armed on the last
  // few bars. The early spike is history, not a missed trade.
  const armedAt = "2026-07-31T13:16:00.000Z";
  const series = [
    { time: "2026-07-31T12:00:00.000Z", open: 100, high: 120, low: 99, close: 101 },
    { time: "2026-07-31T12:30:00.000Z", open: 101, high: 104, low: 100, close: 102 },
    { time: "2026-07-31T13:16:00.000Z", open: 102, high: 103, low: 101, close: 102 },
    { time: "2026-07-31T13:17:00.000Z", open: 102, high: 103.5, low: 101.5, close: 103 },
  ].map((c) => ({ ...c, volume: 100 }));

  it("ignores an excursion that happened before the setup was armed", () => {
    // The exact regression: the 120 high pre-dates arming, and counting it
    // retired live watches as MISSED on their first pass with zero checks.
    const extreme = extremeSinceArmed(series, LONG, armedAt);
    expect(extreme).toBe(103.5);
    expect(targetAlreadyTouched(LONG, 110, extreme)).toBe(false);
  });

  it("still reports a genuine post-arming run to target", () => {
    const extreme = extremeSinceArmed(series, LONG, armedAt);
    expect(targetAlreadyTouched(LONG, 103, extreme)).toBe(true);
  });

  it("returns not-yet-knowable when no bar has closed since arming", () => {
    const extreme = extremeSinceArmed(series, LONG, "2026-07-31T14:00:00.000Z");
    expect(extreme).toBeNull();
    // Null must never be treated as "already missed".
    expect(targetAlreadyTouched(LONG, 103, extreme)).toBe(false);
  });

  it("measures the low side for a short", () => {
    expect(extremeSinceArmed(series, "SHORT", armedAt)).toBe(101);
  });
});
