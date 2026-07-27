import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron entry point for the cloud scanner. Called once per minute by pg_cron.
 *
 * SAFETY: this endpoint only reads market data and writes analysis rows.
 * It never places, modifies or closes a trade.
 */
export const Route = createFileRoute("/api/public/hooks/scan-markets")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Accepted callers: the scheduled job (publishable apikey header) or an
        // operator holding the ingest secret. Never a browser with a user session.
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
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }


        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runScan } = await import("@/lib/ptrades/scanner/run.server");

        try {
          const summary = await runScan(supabaseAdmin);
          return Response.json(summary, { status: summary.ok ? 200 : 503 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "scan failed";
          console.error("scan-markets failed", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
      // Read-only diagnostic: reports whether the market-data account is
      // reachable and deployed. Returns no secrets and no account credentials.
      GET: async ({ request }) => {
        const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!publishable || request.headers.get("apikey") !== publishable) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { getAccountInfo, isMetaApiConfigured, listAccounts } = await import(
          "@/lib/ptrades/scanner/metaapi.server"
        );
        if (!isMetaApiConfigured()) {
          return Response.json({ configured: false });
        }
        const info = await getAccountInfo(true);
        return Response.json({
          configured: true,
          region: info.region,
          state: info.state ?? null,
          connectionStatus: info.connectionStatus ?? null,
          lookupError: info.lookupError ?? null,
          availableAccounts: info.lookupError
            ? await listAccounts().catch(() => [])
            : undefined,
        });
      },

    },
  },
});
