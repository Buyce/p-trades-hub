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
        const { runScan, loadActiveRulebook } = await import(
          "@/lib/ptrades/scanner/run.server"
        );
        const { runPrecisionLoop } = await import("@/lib/ptrades/scanner/precision.server");

        try {
          const summary = await runScan(supabaseAdmin);
          // Execution timing lives in the remainder of this invocation: armed
          // setups are polled every few seconds until the minute is nearly up.
          // Only this loop may turn a setup into an actionable alert.
          const rulebook = await loadActiveRulebook(supabaseAdmin);
          const precision = await runPrecisionLoop(supabaseAdmin, rulebook);
          return Response.json({ ...summary, precision }, { status: summary.ok ? 200 : 503 });
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
        const { marketData } = await import("@/lib/ptrades/scanner/market-data.server");
        const client = marketData();
        if (!client.isConfigured()) {
          return Response.json({ configured: false });
        }
        const info = await client.getAccount(true);
        return Response.json({
          configured: true,
          region: info.region,
          state: info.state ?? null,
          connectionStatus: info.connectionStatus ?? null,
          server: info.server ?? null,
          login: info.login ?? null,
          reliability: info.reliability ?? null,
          lookupError: info.lookupError ?? null,
          accountIdMismatch: info.accountIdMismatch ?? false,
        });

      },

    },
  },
});
