/**
 * Web-push configuration exposed to the browser.
 * Thin wrapper — server-function declarations only. The public VAPID key is
 * safe to hand out; the private key never leaves the server.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getPushPublicKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ publicKey: string | null }> => ({
    publicKey: process.env.VAPID_PUBLIC_KEY ?? null,
  }));
