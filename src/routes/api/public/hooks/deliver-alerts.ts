import { createFileRoute } from "@tanstack/react-router";

/**
 * Alert delivery worker — drains the durable notification outbox independently
 * from market-data and scanner health. A qualified ENTRY_READY signal is
 * committed together with its outbox event; this hook can therefore retry a
 * notification even when the precision scanner is locked, idle or unhealthy.
 *
 * SAFETY: notification delivery only. It never reads trading credentials and
 * can never place, modify or close an order.
 */
export const Route = createFileRoute("/api/public/hooks/deliver-alerts")({
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
        const { drainNotificationOutbox, outboxHeartbeatStatus } =
          await import("@/lib/ptrades/scanner/notification-outbox.server");
        const { safeHeartbeat } = await import("@/lib/ptrades/scanner/heartbeat.server");
        const startedAt = Date.now();

        try {
          const { verifyNotificationChannels } =
            await import("@/lib/ptrades/scanner/notify.server");
          const channels = await verifyNotificationChannels(supabaseAdmin);
          const delivery = await drainNotificationOutbox(supabaseAdmin);
          await safeHeartbeat(supabaseAdmin, {
            source: "ALERT_DELIVERY",
            status: outboxHeartbeatStatus(delivery, channels.problems.length),
            metaapiConnected: null,
            rulebookVersion: null,
            detail: { ...delivery, channels, duration_ms: Date.now() - startedAt },
          });
          return Response.json({ ok: true, delivery, channels });
        } catch (error) {
          const message = error instanceof Error ? error.message : "alert delivery failed";
          console.error("deliver-alerts failed", message);
          await safeHeartbeat(supabaseAdmin, {
            source: "ALERT_DELIVERY",
            status: "ERROR",
            metaapiConnected: null,
            rulebookVersion: null,
            detail: { error: message, duration_ms: Date.now() - startedAt },
          });
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
