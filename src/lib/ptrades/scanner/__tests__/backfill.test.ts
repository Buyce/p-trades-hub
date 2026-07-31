import { describe, expect, it } from "vitest";
import {
  MAX_BACKFILL_DAYS,
  clampBackfillSettings,
  gradeHistoricalBar,
  runBackfillSlice,
} from "../backfill.server";
import { DEFAULT_RULEBOOK } from "../types";
import type { Candle } from "../types";

/**
 * The historical review must stay bounded and journal-only. These tests pin
 * the throttle and the no-alert boundary — the two properties that keep it
 * from starving or contaminating the live pipeline.
 */

describe("historical review throttle", () => {
  it("clamps the window to the retention period", () => {
    expect(clampBackfillSettings({ backfill_days: 90 }).days).toBe(MAX_BACKFILL_DAYS);
    expect(clampBackfillSettings({ backfill_days: -5 }).days).toBe(0);
  });

  it("clamps bars per tick and the time budget to safe bounds", () => {
    const hot = clampBackfillSettings({
      backfill_days: 3,
      backfill_max_bars_per_tick: 999_999,
      backfill_budget_ms: 600_000,
    });
    expect(hot.maxBarsPerTick).toBe(2000);
    expect(hot.budgetMs).toBe(40_000);

    const cold = clampBackfillSettings({
      backfill_days: 3,
      backfill_max_bars_per_tick: 1,
      backfill_budget_ms: 1,
    });
    expect(cold.maxBarsPerTick).toBe(10);
    expect(cold.budgetMs).toBe(2_000);
  });

  it("does no work at all when the review is switched off", async () => {
    const admin = {
      from: () => {
        throw new Error("the database must not be touched when the review is off");
      },
    };
    const result = await runBackfillSlice(admin as never, DEFAULT_RULEBOOK, {
      days: 0,
      maxBarsPerTick: 250,
      budgetMs: 12_000,
      cursor: {},
    });
    expect(result.ran).toBe(false);
    expect(result.complete).toBe(true);
    expect(result.barsJudged).toBe(0);
  });
});

describe("historical bar grading", () => {
  function flat(count: number, price: number): Candle[] {
    return Array.from({ length: count }, (_, i) => ({
      time: new Date(Date.UTC(2026, 6, 20, 0, 0) + i * 15 * 60_000).toISOString(),
      open: price,
      high: price + 0.1,
      low: price - 0.1,
      close: price,
      volume: 100,
    }));
  }

  const instrument = {
    symbol: "EURUSD",
    broker_symbol: "EURUSD",
    aliases: [],
    digits: 5,
    point_size: 0.00001,
    sessions: [],
    enabled: true,
  } as never;

  it("returns no candidate for structureless history and never emits an alert payload", () => {
    const bars = flat(120, 1.1);
    const graded = gradeHistoricalBar({
      instrument,
      brokerSymbol: "EURUSD",
      digits: 5,
      rulebook: DEFAULT_RULEBOOK,
      entry: bars,
      m5: bars,
      h4: bars,
      d1: bars,
    });
    expect(graded.candidate).toBeNull();
    // The only output is gate telemetry — there is no delivery surface here.
    expect(graded.gates.some((g) => g.code === "NO_SETUP")).toBe(true);
    expect(Object.keys(graded)).toEqual(["gates", "candidate"]);
  });

  it("evaluates the session at the replayed bar, not at the current clock", () => {
    const bars = flat(120, 1.1);
    const graded = gradeHistoricalBar({
      instrument,
      brokerSymbol: "EURUSD",
      digits: 5,
      rulebook: DEFAULT_RULEBOOK,
      entry: bars,
      m5: bars,
      h4: bars,
      d1: bars,
    });
    const session = graded.gates.find((g) => g.code === "SESSION");
    expect(session).toBeDefined();
    // Deterministic: replaying the same slice twice gives the same verdict.
    const again = gradeHistoricalBar({
      instrument,
      brokerSymbol: "EURUSD",
      digits: 5,
      rulebook: DEFAULT_RULEBOOK,
      entry: bars,
      m5: bars,
      h4: bars,
      d1: bars,
    });
    expect(again.gates.map((g) => `${g.code}:${g.passed}`)).toEqual(
      graded.gates.map((g) => `${g.code}:${g.passed}`),
    );
  });
});
