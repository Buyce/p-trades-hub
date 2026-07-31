import { createFileRoute } from "@tanstack/react-router";

/**
 * Historical review job.
 *
 * Replays stored candle history under the active rulebook and journals graded
 * candidates. It reads the candle store only — never the market-data provider
 * — and it yields the whole tick whenever the live pipeline is not healthy, so
 * a review can never starve live scanning.
 *
 * SAFETY: writes journal rows only. Never alerts, never arms, never trades.
 */
export const Route = createFileRoute("/api/public/hooks/backfill-scan")({
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
        if (!authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadActiveRulebook } = await import("@/lib/ptrades/scanner/run.server");
        const { safeHeartbeat } = await import("@/lib/ptrades/scanner/heartbeat.server");
        const {
          BACKFILL_LOCK_KEY,
          clampBackfillSettings,
          runBackfillSlice,
          saveBackfillCursor,
        } = await import("@/lib/ptrades/scanner/backfill.server");
        const { acquireScanLock, newLockHolder, releaseScanLock } = await import(
          "@/lib/ptrades/scanner/lock.server"
        );

        const { data: settingsRow } = await supabaseAdmin
          .from("scanner_settings")
          .select(
            "backfill_days, backfill_max_bars_per_tick, backfill_budget_ms, backfill_cursor",
          )
          .eq("id", true)
          .maybeSingle();
        const settings = clampBackfillSettings((settingsRow ?? {}) as never);

        if (settings.days <= 0) {
          return Response.json({ ok: true, skipped: "Historical review is switched off" });
        }

        // Live data comes first. If the sync or precision job is not reporting
        // on schedule, the review stands down entirely for this tick.
        const { data: beats } = await supabaseAdmin
          .from("system_heartbeats")
          .select("source, received_at")
          .in("source", ["MARKET_DATA_SYNC", "PRECISION_SCANNER"])
          .order("received_at", { ascending: false })
          .limit(20);
        const freshest = (source: string) =>
          (beats ?? []).find((b) => b.source === source)?.received_at ?? null;
        const stale = ["MARKET_DATA_SYNC", "PRECISION_SCANNER"].filter((source) => {
          const at = freshest(source);
          return !at || Date.now() - Date.parse(at) > 3 * 60_000;
        });
        if (stale.length > 0) {
          return Response.json({
            ok: true,
            skipped: `Yielding to live pipeline (${stale.join(", ")} not reporting)`,
          });
        }

        const holder = newLockHolder("backfill");
        const locked = await acquireScanLock(supabaseAdmin, {
          key: BACKFILL_LOCK_KEY,
          ttlSeconds: 110,
          holder,
        });
        if (!locked) {
          return Response.json({ ok: true, skipped: "A historical review slice is running" });
        }

        try {
          const rulebook = await loadActiveRulebook(supabaseAdmin);
          const result = await runBackfillSlice(supabaseAdmin, rulebook, settings);
          if (result.ran) await saveBackfillCursor(supabaseAdmin, result.cursor);

          await safeHeartbeat(supabaseAdmin, {
            source: "HISTORICAL_REVIEW",
            status: result.ran ? (result.complete ? "IDLE" : "OK") : "IDLE",
            metaapiConnected: null,
            rulebookVersion: rulebook.version ?? null,
            detail: { ...result },
          });

          return Response.json({ ok: true, backfill: result });
        } catch (error) {
          const message = error instanceof Error ? error.message : "historical review failed";
          console.error("backfill-scan failed", message);
          await safeHeartbeat(supabaseAdmin, {
            source: "HISTORICAL_REVIEW",
            status: "ERROR",
            metaapiConnected: null,
            rulebookVersion: null,
            detail: { error: message },
          });
          return Response.json({ ok: false, error: message }, { status: 500 });
        } finally {
          await releaseScanLock(supabaseAdmin, BACKFILL_LOCK_KEY, holder);
        }
      },
    },
  },
});
