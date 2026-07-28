import { createFileRoute } from "@tanstack/react-router";

/**
 * Precision job — the fast half of the pipeline. Polls the armed watches on
 * closed M1 candles and the live quote. This is the ONLY place a signal
 * becomes actionable and the only place an alert is delivered.
 *
 * It runs on its own schedule so a slow context scan can never starve
 * execution timing, and it takes its own lock so two ticks cannot overlap.
 *
 * SAFETY: reads market data and writes analysis rows only. Never trades.
 */
export const Route = createFileRoute("/api/public/hooks/scan-precision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
        const ingestSecret = process.env.P_TRADES_INGEST_SECRET;
        const apiKey = request.headers.get("apikey") ?? "";
        const bearer =
          request.headers.get("x-scanner-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";

        const authorized =
          (Boolean(publishable) && apiKey === publishable) ||
          (Boolean(ingestSecret) && bearer === ingestSecret);

        if (!authorized) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadActiveRulebook } = await import("@/lib/ptrades/scanner/run.server");
        const { runPrecisionLoop } = await import("@/lib/ptrades/scanner/precision.server");
        const { acquireScanLock, releaseScanLock } = await import(
          "@/lib/ptrades/scanner/lock.server"
        );

        const LOCK_KEY = "precision-loop";
        const locked = await acquireScanLock(supabaseAdmin, {
          key: LOCK_KEY,
          ttlSeconds: 90,
          holder: new Date().toISOString(),
        });
        if (!locked) {
          return Response.json({ ok: true, skipped: "A precision pass is already running" });
        }

        try {
          const rulebook = await loadActiveRulebook(supabaseAdmin);
          const precision = await runPrecisionLoop(supabaseAdmin, rulebook, {
            budgetMs: 45_000,
            intervalMs: 3_000,
          });
          const { checkExecutionStall } = await import(
            "@/lib/ptrades/scanner/watchdog.server"
          );
          const watchdog = await checkExecutionStall(supabaseAdmin).catch(() => null);
          return Response.json({ ok: true, precision, watchdog });
        } catch (error) {
          const message = error instanceof Error ? error.message : "precision pass failed";
          console.error("scan-precision failed", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        } finally {
          await releaseScanLock(supabaseAdmin, LOCK_KEY);
        }
      },
    },
  },
});
