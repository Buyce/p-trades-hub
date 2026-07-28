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
        const { runPrecisionPass } = await import("@/lib/ptrades/scanner/precision.server");
        const { safeHeartbeat } = await import("@/lib/ptrades/scanner/heartbeat.server");
        const { acquireScanLock, releaseScanLock } = await import(
          "@/lib/ptrades/scanner/lock.server"
        );

        const LOCK_KEY = "precision-loop";
        // Short TTL: one pass is seconds of work, so a lock older than this is
        // a crashed invocation and must not block the next tick.
        const locked = await acquireScanLock(supabaseAdmin, {
          key: LOCK_KEY,
          ttlSeconds: 55,
          holder: new Date().toISOString(),
        });
        if (!locked) {
          // Still alive — the previous pass simply had not finished. Silence
          // here would look identical to a dead scanner.
          await safeHeartbeat(supabaseAdmin, {
            source: "PRECISION_SCANNER",
            status: "SKIPPED",
            metaapiConnected: null,
            rulebookVersion: null,
            detail: { reason: "A precision pass was already running." },
          });
          return Response.json({ ok: true, skipped: "A precision pass is already running" });
        }

        const startedAt = Date.now();
        try {
          const rulebook = await loadActiveRulebook(supabaseAdmin);
          const precision = await runPrecisionPass(supabaseAdmin, rulebook);
          const { checkExecutionStall } = await import(
            "@/lib/ptrades/scanner/watchdog.server"
          );
          const watchdog = await checkExecutionStall(supabaseAdmin).catch(() => null);
          // Delivery readiness is reported every pass so a dead channel is
          // visible before a signal needs it, not after one is missed.
          const { verifyNotificationChannels } = await import(
            "@/lib/ptrades/scanner/notify.server"
          );
          const channels = await verifyNotificationChannels(supabaseAdmin).catch(() => null);
          await safeHeartbeat(supabaseAdmin, {
            source: "PRECISION_SCANNER",
            // No open watches is a healthy idle scanner, not a fault.
            status: precision.watched === 0 ? "IDLE" : "OK",
            metaapiConnected: null,
            rulebookVersion: rulebook.version ?? null,
            detail: { ...precision, channels, duration_ms: Date.now() - startedAt },
          });
          return Response.json({ ok: true, precision, watchdog, channels });
        } catch (error) {
          const message = error instanceof Error ? error.message : "precision pass failed";
          console.error("scan-precision failed", message);
          await safeHeartbeat(supabaseAdmin, {
            source: "PRECISION_SCANNER",
            status: "ERROR",
            metaapiConnected: null,
            rulebookVersion: null,
            detail: { error: message, duration_ms: Date.now() - startedAt },
          });
          return Response.json({ ok: false, error: message }, { status: 500 });
        } finally {
          await releaseScanLock(supabaseAdmin, LOCK_KEY);
        }
      },
    },
  },
});
