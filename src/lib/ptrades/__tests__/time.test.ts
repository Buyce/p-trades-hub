import { describe, expect, it } from "vitest";
import {
  ageSeconds,
  formatInUserTimezone,
  getUtcDayBoundary,
  isClosedCandle,
  toUtcIso,
  utcTradingDay,
} from "@/lib/ptrades/time";

describe("time utilities", () => {
  it("normalises any accepted input to UTC ISO", () => {
    expect(toUtcIso("2026-01-05T12:00:00Z")).toBe("2026-01-05T12:00:00.000Z");
    expect(toUtcIso(new Date(Date.UTC(2026, 0, 5, 12)))).toBe("2026-01-05T12:00:00.000Z");
    expect(toUtcIso(Date.UTC(2026, 0, 5, 12))).toBe("2026-01-05T12:00:00.000Z");
  });

  it("returns null instead of inventing a timestamp", () => {
    expect(toUtcIso(null)).toBeNull();
    expect(toUtcIso("")).toBeNull();
    expect(toUtcIso("not a date")).toBeNull();
  });

  it("derives the UTC trading day regardless of local timezone", () => {
    expect(utcTradingDay("2026-01-05T23:59:59Z")).toBe("2026-01-05");
    expect(utcTradingDay("2026-01-06T00:00:00Z")).toBe("2026-01-06");
  });

  it("produces an inclusive start and exclusive end for a UTC day", () => {
    const boundary = getUtcDayBoundary("2026-01-05T13:22:00Z");
    expect(boundary).toEqual({
      day: "2026-01-05",
      startIso: "2026-01-05T00:00:00.000Z",
      endIso: "2026-01-06T00:00:00.000Z",
    });
  });

  it("treats a candle as closed only once its full period has elapsed", () => {
    const open = "2026-01-05T12:00:00Z";
    const closeAt = Date.parse("2026-01-05T12:05:00Z");
    expect(isClosedCandle(open, "M5", closeAt - 1)).toBe(false);
    expect(isClosedCandle(open, "M5", closeAt)).toBe(true);
    expect(isClosedCandle(open, "M15", closeAt)).toBe(false);
  });

  it("fails closed on an unparseable candle time", () => {
    expect(isClosedCandle("nonsense", "M5", Date.now())).toBe(false);
  });

  it("reports age in seconds and never a negative value", () => {
    const now = Date.parse("2026-01-05T12:00:00Z");
    expect(ageSeconds("2026-01-05T11:59:00Z", now)).toBe(60);
    expect(ageSeconds("2026-01-05T12:01:00Z", now)).toBe(0);
    expect(ageSeconds(null, now)).toBeNull();
  });

  it("renders display time in a timezone without shifting the UTC instant", () => {
    const iso = "2026-01-05T12:00:00Z";
    expect(formatInUserTimezone(iso, "UTC")).toContain("12:00");
    expect(formatInUserTimezone(iso, "Asia/Tokyo")).toContain("21:00");
    expect(formatInUserTimezone(null, "UTC")).toBeNull();
  });

  it("falls back to the ISO string for an unknown timezone", () => {
    expect(formatInUserTimezone("2026-01-05T12:00:00Z", "Mars/Olympus")).toBe(
      "2026-01-05T12:00:00.000Z",
    );
  });
});
