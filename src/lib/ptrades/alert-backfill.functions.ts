/**
 * Historical review settings.
 *
 * Thin wrapper module: server-function declarations only. Owner/admin callers
 * choose how many past days the scanner re-grades under the active rulebook,
 * and how hard the review is throttled so it never competes with live scanning.
 *
 * The review is journal-only: it never alerts, arms or trades.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type StaffContext = {
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  };
  userId: string;
};

async function assertStaff(context: unknown) {
  const ctx = context as unknown as StaffContext;
  const { data, error } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (error || data !== true) throw new Error("Forbidden: owner or admin role required.");
}

export type BackfillConfig = {
  days: number;
  maxBarsPerTick: number;
  budgetMs: number;
  cursor: {
    instrument: string | null;
    afterBarTime: string | null;
    windowStart: string | null;
    completedAt: string | null;
  };
};

export const getBackfillConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackfillConfig> => {
    await assertStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { clampBackfillSettings } = await import("@/lib/ptrades/scanner/backfill.server");
    const { data } = await supabaseAdmin
      .from("scanner_settings")
      .select("backfill_days, backfill_max_bars_per_tick, backfill_budget_ms, backfill_cursor")
      .eq("id", true)
      .maybeSingle();
    const settings = clampBackfillSettings((data ?? {}) as never);
    return {
      days: settings.days,
      maxBarsPerTick: settings.maxBarsPerTick,
      budgetMs: settings.budgetMs,
      cursor: {
        instrument: settings.cursor.instrument ?? null,
        afterBarTime: settings.cursor.afterBarTime ?? null,
        windowStart: settings.cursor.windowStart ?? null,
        completedAt: settings.cursor.completedAt ?? null,
      },
    };
  });

export const setBackfillConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        // 14 days is the candle-store retention; beyond it there is no history.
        days: z.number().int().min(0).max(14),
        maxBarsPerTick: z.number().int().min(10).max(2000),
        budgetMs: z.number().int().min(2000).max(40000),
        restart: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<BackfillConfig> => {
    await assertStaff(context);
    const ctx = context as unknown as StaffContext;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const patch: Record<string, unknown> = {
      backfill_days: data.days,
      backfill_max_bars_per_tick: data.maxBarsPerTick,
      backfill_budget_ms: data.budgetMs,
    };
    // Changing the window (or asking for a rerun) resets the cursor so the
    // review starts from the beginning of the new window.
    if (data.restart || data.days === 0) patch["backfill_cursor"] = {};

    const { error } = await supabaseAdmin
      .from("scanner_settings")
      .update(patch as never)
      .eq("id", true);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_log").insert({
      actor_kind: "USER",
      actor_user_id: ctx.userId,
      action: "BACKFILL_CONFIG_SET",
      entity_type: "scanner_settings",
      detail: patch as never,
    });

    return getBackfillConfig();
  });
