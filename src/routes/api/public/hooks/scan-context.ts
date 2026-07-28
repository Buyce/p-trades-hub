import { createFileRoute } from "@tanstack/react-router";

/**
 * Context scan — the slow half of the pipeline. Detects M15 setups and ARMS
 * the valid ones. It never alerts: only the precision job may make a signal
 * actionable.
 *
 * Split out from the old combined job because a scan plus an in-line precision
 * loop regularly overran the one-minute tick and timed out under the lock.
 *
 * SAFETY: reads market data and writes analysis rows only. It can never place,
 * modify or close a trade.
 */
export const Route = createFileRoute("/api/public/hooks/scan-context")({
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
        const { runScan } = await import("@/lib/ptrades/scanner/run.server");

        try {
          const summary = await runScan(supabaseAdmin);
          return Response.json(summary, { status: summary.ok ? 200 : 503 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "scan failed";
          console.error("scan-context failed", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
