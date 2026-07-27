/**
 * The single time utility for P-Trades.
 *
 * UTC is canonical everywhere: storage, trading days, scanner decisions and
 * exports. A user timezone is a display concern only and never changes which
 * UTC day a record belongs to.
 */

import { TIMEFRAME_SECONDS, type Timeframe } from "./scanner/types";

export const MS = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;

/** Any accepted input converted to a canonical UTC ISO string, or null. */
export function toUtcIso(value: string | number | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** The UTC trading day (YYYY-MM-DD) a moment belongs to. */
export function utcTradingDay(value: string | number | Date = new Date()): string {
  const iso = toUtcIso(value);
  if (!iso) throw new Error("utcTradingDay: invalid input");
  return iso.slice(0, 10);
}

/** Inclusive start and exclusive end of a UTC day, as ISO strings. */
export function getUtcDayBoundary(value: string | number | Date = new Date()): {
  day: string;
  startIso: string;
  endIso: string;
} {
  const day = utcTradingDay(value);
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return {
    day,
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + MS.day).toISOString(),
  };
}

/** True when the candle period that opened at `openIso` has fully elapsed. */
export function isClosedCandle(
  openIso: string,
  timeframe: Timeframe,
  now: number | Date = Date.now(),
): boolean {
  const opened = Date.parse(openIso);
  if (Number.isNaN(opened)) return false;
  const nowMs = now instanceof Date ? now.getTime() : now;
  return opened + TIMEFRAME_SECONDS[timeframe] * 1000 <= nowMs;
}

/** Seconds elapsed since an ISO timestamp; null when the input is unusable. */
export function ageSeconds(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, (now - ms) / 1000);
}

/**
 * Display-only rendering of a UTC instant in the user's timezone.
 * Returns null for unusable input so callers decide the fallback label.
 */
export function formatInUserTimezone(
  iso: string | null | undefined,
  timezone: string,
  opts: Intl.DateTimeFormatOptions = {},
): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...opts,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}
