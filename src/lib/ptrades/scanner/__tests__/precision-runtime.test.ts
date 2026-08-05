import { describe, expect, it } from "vitest";
import { detectPersistedTriggerRetest } from "../micro-trigger.server";
import { lastClosedM1Time } from "../precision.server";
import {
  aggregateHeartbeatHealth,
  COMPONENT_HEARTBEAT_SOURCES,
  componentHeartbeatHealth,
  contextRuntimeHealth,
  HEARTBEAT_SOURCES,
  heartbeatHealth,
  heartbeatLabel,
  heartbeatPillState,
} from "@/lib/ptrades/heartbeat-health";
import type { Candle } from "../types";

const candle = (time: string, o: number, h: number, l: number, c: number): Candle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 100,
});

describe("heartbeat freshness", () => {
  const now = Date.parse("2026-07-28T17:00:00.000Z");

  it("treats a heartbeat inside one scheduler tick as healthy", () => {
    expect(heartbeatHealth("2026-07-28T16:59:10.000Z", now)).toBe("HEALTHY");
  });

  it("treats a stale OK as offline rather than healthy", () => {
    // The exact regression: a 13-minute-old row still said OK on screen.
    expect(heartbeatHealth("2026-07-28T16:47:00.000Z", now)).toBe("OFFLINE");
    expect(heartbeatPillState(heartbeatHealth("2026-07-28T16:47:00.000Z", now))).toBe("down");
    expect(heartbeatLabel("OFFLINE")).toBe("Not reporting");
  });

  it("flags the gap between one and several missed ticks as degraded", () => {
    expect(heartbeatHealth("2026-07-28T16:56:30.000Z", now)).toBe("DEGRADED");
  });

  it("reports unknown, never healthy, when nothing has been received", () => {
    expect(heartbeatHealth(null, now)).toBe("UNKNOWN");
    expect(heartbeatHealth("not-a-date", now)).toBe("UNKNOWN");
  });

  it("observes delivery without treating it as a scanner job", () => {
    expect(COMPONENT_HEARTBEAT_SOURCES).toContain("ALERT_DELIVERY");
    expect(HEARTBEAT_SOURCES).not.toContain("ALERT_DELIVERY");
  });

  it("fails a fresh heartbeat closed when the worker reports an error", () => {
    expect(componentHeartbeatHealth("2026-07-28T16:59:50.000Z", "ERROR", now)).toBe("OFFLINE");
  });

  it("preserves degraded worker outcomes even while the scheduler is current", () => {
    expect(componentHeartbeatHealth("2026-07-28T16:59:50.000Z", "DEGRADED", now)).toBe("DEGRADED");
    expect(componentHeartbeatHealth("2026-07-28T16:59:50.000Z", "OK", now)).toBe("HEALTHY");
  });

  it("calls the whole pipeline live only when every required worker is healthy", () => {
    expect(aggregateHeartbeatHealth(["HEALTHY", "HEALTHY", "HEALTHY", "HEALTHY"])).toBe("HEALTHY");
    expect(aggregateHeartbeatHealth(["HEALTHY", "UNKNOWN", "HEALTHY", "HEALTHY"])).toBe("UNKNOWN");
    expect(aggregateHeartbeatHealth(["HEALTHY", "DEGRADED", "HEALTHY", "HEALTHY"])).toBe(
      "DEGRADED",
    );
    expect(aggregateHeartbeatHealth(["HEALTHY", "OFFLINE", "HEALTHY", "HEALTHY"])).toBe("OFFLINE");
  });

  it("surfaces a completed but data-degraded context scan", () => {
    const runtime = contextRuntimeHealth(
      {
        latestAt: "2026-07-28T16:59:50.000Z",
        latestStatus: "DEGRADED",
        recentStatuses: ["DEGRADED", "OK"],
        lastSuccessAt: "2026-07-28T16:59:50.000Z",
      },
      now,
    );
    expect(runtime.health).toBe("DEGRADED");
    expect(runtime.reason).toContain("degraded data");
  });
});

describe("M1 cache key", () => {
  it("names the newest candle that can already be closed", () => {
    expect(lastClosedM1Time(Date.parse("2026-07-28T17:00:30.000Z"))).toBe(
      "2026-07-28T16:59:00.000Z",
    );
  });

  it("does not advance until the next minute closes", () => {
    const a = lastClosedM1Time(Date.parse("2026-07-28T17:00:01.000Z"));
    const b = lastClosedM1Time(Date.parse("2026-07-28T17:00:59.000Z"));
    expect(a).toBe(b);
  });
});

describe("persisted trigger retest", () => {
  const trigger = {
    brokenLevel: 100,
    bosCandleTime: "2026-07-28T16:50:00.000Z",
    direction: "LONG" as const,
  };
  const candles = [
    candle("2026-07-28T16:50:00.000Z", 99, 101, 98.9, 100.8),
    candle("2026-07-28T16:51:00.000Z", 100.8, 100.9, 100.05, 100.4),
  ];

  it("confirms when a later candle returns to the stored level and holds it", () => {
    const result = detectPersistedTriggerRetest({ candles, trigger, atrM1: 0.5 });
    expect(result.confirmed).toBe(true);
    expect(result.retestCandleTime).toBe("2026-07-28T16:51:00.000Z");
    expect(result.brokenLevel).toBe(100);
  });

  it("keeps the stored level instead of re-deriving a new one", () => {
    const result = detectPersistedTriggerRetest({ candles, trigger, atrM1: 0.5 });
    expect(result.triggered).toBe(true);
    expect(result.bosCandleTime).toBe(trigger.bosCandleTime);
  });

  it("stays unconfirmed while price never returns to the level, when the retest is required", () => {
    const away = [candles[0], candle("2026-07-28T16:51:00.000Z", 100.8, 101.5, 100.75, 101.4)];
    const result = detectPersistedTriggerRetest({
      candles: away,
      trigger,
      atrM1: 0.05,
      requireRetest: true,
    });
    expect(result.confirmed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("confirms on the break alone when the rulebook does not require a retest", () => {
    const away = [candles[0], candle("2026-07-28T16:51:00.000Z", 100.8, 101.5, 100.75, 101.4)];
    const result = detectPersistedTriggerRetest({
      candles: away,
      trigger,
      atrM1: 0.05,
      requireRetest: false,
    });
    expect(result.confirmed).toBe(true);
    expect(result.retestCandleTime).toBeNull();
  });

  it("fails closed when the M1 ATR is unavailable", () => {
    const result = detectPersistedTriggerRetest({
      candles,
      trigger,
      atrM1: null,
      requireRetest: false,
    });
    expect(result.confirmed).toBe(false);
  });

  it("does not confirm a candle that closes back through the level", () => {
    const broke = [candles[0], candle("2026-07-28T16:51:00.000Z", 100.8, 100.9, 99.4, 99.5)];
    const result = detectPersistedTriggerRetest({
      candles: broke,
      trigger,
      atrM1: 0.5,
      requireRetest: true,
    });
    expect(result.confirmed).toBe(false);
  });
});
