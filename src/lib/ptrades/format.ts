/**
 * Presentation helpers. These NEVER compute trading logic — they only format
 * values that the Python backend already decided.
 */

export const UNAVAILABLE = "Unavailable";

export function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/** Render any backend field, falling back to "Unavailable" — never invent data. */
export function field(value: unknown): string {
  return hasValue(value) ? String(value) : UNAVAILABLE;
}

export function num(value: number | null | undefined, digits = 5): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNAVAILABLE;
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function rr(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  return `${Number(value).toFixed(2)}R`;
}

export function score(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  return Number(value).toFixed(2);
}

export const GRADE_LABEL: Record<string, string> = {
  A_PLUS: "A+",
  A: "A",
  B: "B",
};

export function gradeLabel(grade: string | null | undefined): string {
  if (!grade) return UNAVAILABLE;
  return GRADE_LABEL[grade] ?? grade;
}

/** Format a UTC timestamp in the user's selected timezone. UTC stays canonical. */
export function formatTime(
  iso: string | null | undefined,
  timezone: string,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  if (!iso) return UNAVAILABLE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return UNAVAILABLE;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...opts,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function relativeFromNow(iso: string | null | undefined): string {
  if (!iso) return UNAVAILABLE;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return UNAVAILABLE;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export const TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "America/New_York",
  "America/Chicago",
  "Asia/Dubai",
  "Asia/Tokyo",
  "Australia/Sydney",
];
