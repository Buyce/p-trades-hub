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
        const expected = process.env.P_TRADES_INGEST_SECRET;
        const provided =
          request.headers.get("x-scanner-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";

        if (!expected || provided !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runScan } = await import("@/lib/ptrades/scanner/run.server");

        try {
          const summary = await runScan(supabaseAdmin);
          await supabaseAdmin
            .from("scanner_settings")
            .update({ last_scan_at: new Date().toISOString() })
            .eq("id", true);
          return Response.json(summary, { status: summary.ok ? 200 : 503 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "scan failed";
          console.error("scan-markets failed", message);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
