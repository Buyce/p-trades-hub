import { createFileRoute } from "@tanstack/react-router";

/**
 * Market-data sync — the data plane. Downloads closed candle history from the
 * broker and writes it to the durable store that the context scan reads.
 *
 * Split out because the context scan cannot both download five timeframes per
 * instrument through one broker resource slot AND finish inside its lock. This
 * job owns every history download; nothing else may make one.
 *
 * SAFETY: read-only market data. It can never place, modify or close a trade.
 */
export const Route = createFileRoute("/api/public/hooks/sync-market-data")({
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
        const { runMarketDataSync, SYNC_LOCK_TTL_SECONDS } = await import(
          "@/lib/ptrades/scanner/sync.server"
        );
        const { acquireScanLock, releaseScanLock, newLockHolder, SYNC_LOCK_KEY } = await import(
          "@/lib/ptrades/scanner/lock.server"
        );
        const { safeHeartbeat } = await import("@/lib/ptrades/scanner/heartbeat.server");

        const holder = newLockHolder("sync");
        const locked = await acquireScanLock(supabaseAdmin, {
          key: SYNC_LOCK_KEY,
          ttlSeconds: SYNC_LOCK_TTL_SECONDS,
          holder,
        });
        if (!locked) {
          await safeHeartbeat(supabaseAdmin, {
            source: "MARKET_DATA_SYNC",
            status: "SKIPPED",
            metaapiConnected: null,
            rulebookVersion: null,
            detail: { reason: "A market-data sync was already running." },
          });
          return Response.json({ ok: true, skipped: "A sync is already running" });
        }

        try {
          const summary = await runMarketDataSync(supabaseAdmin, holder);
          return Response.json(summary, { status: summary.ok ? 200 : 503 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "sync failed";
          console.error("sync-market-data failed", message);
          await safeHeartbeat(supabaseAdmin, {
            source: "MARKET_DATA_SYNC",
            status: "ERROR",
            metaapiConnected: null,
            rulebookVersion: null,
            detail: { error: message },
          });
          return Response.json({ ok: false, error: message }, { status: 500 });
        } finally {
          await releaseScanLock(supabaseAdmin, SYNC_LOCK_KEY, holder);
        }
      },
    },
  },
});
