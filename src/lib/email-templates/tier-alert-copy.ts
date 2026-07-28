/**
 * Per-tier email copy. The tier stored on the signal picks the subject line and
 * the body wording, so a recipient can tell from the inbox row alone which tier
 * triggered the alert. Nothing here recomputes or upgrades a tier — an unknown
 * tier falls back to neutral copy.
 */

import type { Tier } from "@/lib/ptrades/tiers";

export type TierCopy = {
  /** Short prefix that opens the subject line. */
  subjectPrefix: string;
  /** Coloured banner text above the heading. */
  banner: string;
  /** One-line framing under the heading. */
  intro: string;
  /** Tier-specific caution or handling note. */
  note: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
};

const NEUTRAL: TierCopy = {
  subjectPrefix: "Signal",
  banner: "UNLABELLED TIER",
  intro:
    "This setup passed every rulebook gate but carries no stored tier. Treat it as informational only.",
  note: "No tier is stored on this signal, so no tier-based handling is implied.",
  accent: "#647384",
  accentBg: "#f2f4f7",
  accentBorder: "#e3e8ee",
};

export const TIER_EMAIL_COPY: Record<Tier, TierCopy> = {
  A_PLUS: {
    subjectPrefix: "Tier A+",
    banner: "TIER A+ — HIGHEST CONVICTION",
    intro:
      "Highest-conviction setup. Every gate passed inside the strongest score band and the full reward-to-risk floor.",
    note: "Top-tier alert. Still your decision and your manual execution.",
    accent: "#0e7490",
    accentBg: "#ecfeff",
    accentBorder: "#a5e5ef",
  },
  A: {
    subjectPrefix: "Tier A",
    banner: "TIER A — HIGH CONVICTION",
    intro:
      "High-conviction setup that cleared every gate at the full reward-to-risk minimum.",
    note: "Standard high-tier alert. Still your decision and your manual execution.",
    accent: "#0e7490",
    accentBg: "#ecfeff",
    accentBorder: "#a5e5ef",
  },
  B: {
    subjectPrefix: "Tier B",
    banner: "TIER B — LOWER REWARD-TO-RISK FLOOR",
    intro:
      "Solid setup that passed the same hard gates as the top tiers, but on a lower reward-to-risk floor (1.5R minimum).",
    note: "Tier B is a secondary alert. Size it below your Tier A risk and skip it when your daily risk is already committed.",
    accent: "#a16207",
    accentBg: "#fefce8",
    accentBorder: "#f0d78c",
  },
  C: {
    subjectPrefix: "Tier C",
    banner: "TIER C — WATCH ONLY, RELAXED R:R",
    intro:
      "Lowest tier. Identical safety gates, relaxed reward-to-risk only (1.2R minimum), so the payoff profile is the thinnest of the four tiers.",
    note: "Tier C is a watch-list alert. Treat it as context and journal material rather than a headline trade.",
    accent: "#647384",
    accentBg: "#f5f7fa",
    accentBorder: "#dfe4ea",
  },
};

export function tierCopy(tier: Tier | null | undefined): TierCopy {
  return tier ? TIER_EMAIL_COPY[tier] : NEUTRAL;
}

/** Subject line for an alert email, tier-first so the inbox row is unambiguous. */
export function tierSubject(
  tier: Tier | null | undefined,
  input: { instrument: string; direction: string; rrTp1: string },
): string {
  const copy = tierCopy(tier);
  return `${copy.subjectPrefix} · ${input.instrument} ${input.direction} — ${input.rrTp1} to TP1`;
}
