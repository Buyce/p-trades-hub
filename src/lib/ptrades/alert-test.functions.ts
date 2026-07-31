/**
 * Alert delivery test mode.
 *
 * Thin wrapper module: server-function declarations only. Owner/admin callers
 * can switch on a mode where the scanner delivers one clearly labelled sample
 * alert as soon as a setup reaches ARMED, so the in-app, push and email
 * channels can be proven without waiting for an M1 execution trigger.
 *
 * This never changes detection, scoring, tiers or actionability, and it never
 * exposes any trading capability.
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

export const getAlertTestMode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ enabled: boolean }> => {
    await assertStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("scanner_settings")
      .select("alert_test_mode")
      .eq("id", true)
      .maybeSingle();
    return {
      enabled: (data as { alert_test_mode?: boolean } | null)?.alert_test_mode === true,
    };
  });

export const setAlertTestMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }): Promise<{ enabled: boolean }> => {
    await assertStaff(context);
    const ctx = context as unknown as StaffContext;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("scanner_settings")
      .update({ alert_test_mode: data.enabled } as never)
      .eq("id", true);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_log").insert({
      actor_kind: "USER",
      actor_user_id: ctx.userId,
      action: data.enabled ? "ALERT_TEST_MODE_ON" : "ALERT_TEST_MODE_OFF",
      entity_type: "scanner_settings",
      detail: { alert_test_mode: data.enabled } as never,
    });

    return { enabled: data.enabled };
  });
