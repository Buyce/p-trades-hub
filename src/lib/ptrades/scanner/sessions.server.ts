/**
 * Trading-session model. Pure UTC arithmetic — no market data, no side effects.
 * Sessions are used as a hard gate: a setup that forms outside an instrument's
 * allowed sessions is rejected, never downgraded.
 */

export type Session = "ASIA" | "LONDON" | "NEWYORK" | "OFF_SESSION" | "CLOSED";

/** UTC session windows [startHour, endHour). */
export const SESSION_WINDOWS: Record<"ASIA" | "LONDON" | "NEWYORK", [number, number]> = {
  ASIA: [0, 7],
  LONDON: [7, 13],
  NEWYORK: [13, 21],
};

/** True when the FX week is closed (Fri 21:00 UTC through Sun 21:00 UTC). */
export function isMarketClosed(date: Date): boolean {
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  if (day === 6) return true; // Saturday
  if (day === 0 && hour < 21) return true; // Sunday before the open
  if (day === 5 && hour >= 21) return true; // Friday after the close
  return false;
}

export function sessionAt(date: Date): Session {
  if (isMarketClosed(date)) return "CLOSED";
  const hour = date.getUTCHours();
  for (const [name, [start, end]] of Object.entries(SESSION_WINDOWS)) {
    if (hour >= start && hour < end) return name as Session;
  }
  return "OFF_SESSION";
}

/** An empty allow-list means the instrument has no session restriction. */
export function isSessionAllowed(session: Session, allowed: string[] | null | undefined): boolean {
  if (session === "CLOSED") return false;
  if (!allowed || allowed.length === 0) return session !== "CLOSED";
  return allowed.includes(session);
}
