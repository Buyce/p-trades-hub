/**
 * Alert tiers. One shared vocabulary for the scanner, the notification
 * fan-out, the email templates and every screen, so a tier shown anywhere is
 * always the tier stored on the signal row. Nothing here recomputes a grade.
 */

export type Tier = "A_PLUS" | "A" | "B" | "C";

export const TIERS: Tier[] = ["A_PLUS", "A", "B", "C"];

export const TIER_LABEL: Record<Tier, string> = {
  A_PLUS: "A+",
  A: "A",
  B: "B",
  C: "C",
};

export const TIER_DESCRIPTION: Record<Tier, string> = {
  A_PLUS: "Highest conviction. Every gate passed with the strongest score band.",
  A: "High conviction. Full reward-to-risk minimum.",
  B: "Solid setup on a slightly lower reward-to-risk floor.",
  C: "Lowest tier. Same safety gates, relaxed reward-to-risk only.",
};

// Every tier is actionable, so a new user receives every tier by default and
// opts out rather than opting in.
export const DEFAULT_EMAIL_TIERS: Tier[] = ["A_PLUS", "A", "B", "C"];
export const DEFAULT_PUSH_TIERS: Tier[] = ["A_PLUS", "A", "B", "C"];
export const DEFAULT_TERMINAL_TIERS: Tier[] = ["A_PLUS", "A", "B", "C"];

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as string[]).includes(value);
}

export function tierLabel(value: string | null | undefined): string {
  return isTier(value) ? TIER_LABEL[value] : "—";
}

/** Normalises a stored preference array, falling back to the given default. */
export function parseTiers(value: unknown, fallback: Tier[]): Tier[] {
  if (!Array.isArray(value)) return fallback;
  const tiers = value.filter(isTier);
  return tiers.length > 0 ? tiers : [];
}

/** Reporting bucket for a tier. A+ and A are grouped in funnel counts. */
export function tierBucket(tier: Tier): "A" | "B" | "C" {
  return tier === "A_PLUS" || tier === "A" ? "A" : tier;
}
