import type { Rulebook } from "./types";
import { DEFAULT_PRECISION, DEFAULT_PRECISION_INSTRUMENT, DEFAULT_RULEBOOK } from "./types";
import { assertScorecards, deadBands } from "./scoring";

/**
 * Strict rulebook validation with deep merging.
 *
 * A stored rulebook is a PARTIAL override of the defaults. The old loader used
 * a shallow spread, so overriding one key of `grades` or `precision` silently
 * deleted every sibling key and the scanner ran on a half-configured rulebook
 * without saying so.
 *
 * Validation is fail-closed in one specific sense: a rulebook that is
 * structurally invalid, or that makes a grade band unreachable for a setup
 * family, is REJECTED and the previous known-good configuration (the defaults)
 * is used, with the reason recorded.
 */

export type RulebookIssue = { path: string; message: string };

export type RulebookValidation = {
  rulebook: Rulebook;
  valid: boolean;
  issues: RulebookIssue[];
  /** Families/grades that cannot be reached under the merged configuration. */
  dead: Array<{ family: string; grade: string }>;
  /** True when the defaults were substituted for a rejected configuration. */
  fellBack: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursive merge where an override object never deletes sibling defaults. */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return base;
  if (!isPlainObject(base)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) ? deepMerge((base as Record<string, unknown>)[key], value) : value;
  }
  return out as T;
}

function requirePositive(
  value: unknown,
  path: string,
  issues: RulebookIssue[],
  { allowZero = false } = {},
) {
  if (typeof value !== "number" || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    issues.push({ path, message: `must be a finite number ${allowZero ? ">= 0" : "> 0"}` });
  }
}

export function validateRulebook(
  raw: unknown,
  version = DEFAULT_RULEBOOK.version,
): RulebookValidation {
  const issues: RulebookIssue[] = [];
  const merged: Rulebook = {
    ...deepMerge(DEFAULT_RULEBOOK, raw),
    version,
    precision: deepMerge(DEFAULT_PRECISION, (raw as Partial<Rulebook> | null)?.precision),
  };
  merged.precision.default = deepMerge(DEFAULT_PRECISION_INSTRUMENT, merged.precision.default);

  requirePositive(merged.atr_period, "atr_period", issues);
  requirePositive(merged.swing_lookback, "swing_lookback", issues);
  requirePositive(merged.displacement_min_atr, "displacement_min_atr", issues);
  requirePositive(merged.max_data_age_seconds, "max_data_age_seconds", issues);
  requirePositive(merged.max_spread_atr_ratio, "max_spread_atr_ratio", issues);
  requirePositive(merged.late_entry_max_atr_from_entry, "late_entry_max_atr_from_entry", issues);
  requirePositive(merged.max_stop_atr_multiple, "max_stop_atr_multiple", issues);
  requirePositive(merged.signal_expiry_minutes, "signal_expiry_minutes", issues);

  if (merged.atr_method !== "WILDER" && merged.atr_method !== "SMA") {
    issues.push({ path: "atr_method", message: "must be WILDER or SMA" });
  }
  if (!Array.isArray(merged.allowed_sessions) || merged.allowed_sessions.length === 0) {
    issues.push({ path: "allowed_sessions", message: "must list at least one session" });
  }

  const tiers = ["A_PLUS", "A", "B", "C"] as const;
  for (const tier of tiers) {
    requirePositive(merged.grades?.[tier], `grades.${tier}`, issues);
    requirePositive(merged.tier_min_rr?.[tier], `tier_min_rr.${tier}`, issues);
  }
  // Bands must be strictly descending, otherwise a tier can never be resolved.
  const bands = tiers.map((t) => merged.grades?.[t]);
  for (let i = 1; i < bands.length; i += 1) {
    if (typeof bands[i] === "number" && typeof bands[i - 1] === "number" && bands[i]! >= bands[i - 1]!) {
      issues.push({
        path: `grades.${tiers[i]}`,
        message: `must be below grades.${tiers[i - 1]} (${bands[i]} >= ${bands[i - 1]})`,
      });
    }
  }

  const arming = merged.arming_displacement_min_atr;
  if (arming !== undefined && (typeof arming !== "number" || arming <= 0)) {
    issues.push({ path: "arming_displacement_min_atr", message: "must be a number > 0" });
  }
  if (typeof arming === "number" && arming > merged.displacement_min_atr) {
    issues.push({
      path: "arming_displacement_min_atr",
      message: "cannot exceed displacement_min_atr — arming would be stricter than final quality",
    });
  }

  requirePositive(merged.precision.min_entry_ready_rr, "precision.min_entry_ready_rr", issues);
  requirePositive(merged.precision.trigger_expiry_bars, "precision.trigger_expiry_bars", issues);

  try {
    assertScorecards();
  } catch (error) {
    issues.push({
      path: "scorecards",
      message: error instanceof Error ? error.message : "invalid scorecards",
    });
  }

  const dead = issues.length === 0 ? deadBands(merged) : [];
  for (const band of dead) {
    issues.push({
      path: `grades.${band.grade}`,
      message: `unreachable for ${band.family}: no combination of inputs can score into this band`,
    });
  }

  const valid = issues.length === 0;
  return {
    rulebook: valid ? merged : { ...DEFAULT_RULEBOOK, version: `${version} (rejected)` },
    valid,
    issues,
    dead,
    fellBack: !valid,
  };
}
