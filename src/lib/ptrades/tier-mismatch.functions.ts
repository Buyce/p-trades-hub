/**
 * Tier mismatch detector.
 *
 * The UI must always render the tier stored on a signal row. If a screen ever
 * shows a different tier than the database holds — stale cache, drifted
 * client state, a bad prop — we treat it as a governance incident: log it to
 * the audit trail and notify the user, fail-loud. Nothing here recomputes or
 * "corrects" a tier; it only compares and reports.
 *
 * Thin wrapper module: server-function declarations only.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TierMismatchResult = {
  /** True when the displayed tier differs from the stored tier. */
  mismatch: boolean;
  /** Tier stored on the signal row, or null when the row has none. */
  storedTier: string | null;
  displayedTier: string | null;
  /** Surface that reported the comparison. */
  surface: string;
  /** True when the incident was written to the audit trail this call. */
  logged: boolean;
};

const schema = z.object({
  signalId: z.string().uuid(),
  displayedTier: z.string().max(16).nullable(),
  surface: z.string().max(64).default("unknown"),
});

export const reportTierMismatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }): Promise<TierMismatchResult> => {
    const { signalId, displayedTier, surface } = data;

    const { data: row, error } = await context.supabase
      .from("signals")
      .select("id, instrument, grade, trading_day_utc")
      .eq("id", signalId)
      .maybeSingle();

    if (error) throw error;
    if (!row) {
      return {
        mismatch: false,
        storedTier: null,
        displayedTier,
        surface,
        logged: false,
      };
    }

    const storedTier = row.grade ?? null;
    const normalisedDisplayed = displayedTier ?? null;
    if (storedTier === normalisedDisplayed) {
      return { mismatch: false, storedTier, displayedTier, surface, logged: false };
    }

    // Fail loud in server logs so scanner health reviews pick it up.
    console.error(
      `[tier-mismatch] signal=${signalId} instrument=${row.instrument} stored=${storedTier} displayed=${normalisedDisplayed} surface=${surface}`,
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Dedupe: one incident per signal + displayed tier per trading day.
    const entityId = `${signalId}:${normalisedDisplayed ?? "none"}`;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabaseAdmin
      .from("audit_log")
      .select("id")
      .eq("action", "TIER_MISMATCH")
      .eq("entity_id", entityId)
      .gte("created_at", since)
      .limit(1);

    if (existing && existing.length > 0) {
      return { mismatch: true, storedTier, displayedTier, surface, logged: false };
    }

    await supabaseAdmin.from("audit_log").insert({
      actor_user_id: context.userId,
      actor_kind: "system",
      action: "TIER_MISMATCH",
      entity_type: "signal",
      entity_id: entityId,
      detail: {
        signal_id: signalId,
        instrument: row.instrument,
        trading_day_utc: row.trading_day_utc,
        stored_tier: storedTier,
        displayed_tier: normalisedDisplayed,
        surface,
        detected_at: new Date().toISOString(),
      },
    });

    await supabaseAdmin.from("notifications").insert({
      user_id: context.userId,
      signal_id: signalId,
      title: `Tier mismatch on ${row.instrument}`,
      body: `The screen showed tier ${normalisedDisplayed ?? "—"} but the stored tier is ${storedTier ?? "—"}. The stored tier is authoritative.`,
    });

    return { mismatch: true, storedTier, displayedTier, surface, logged: true };
  });
