import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const signalSchema = z.object({
  external_id: z.string().max(200).optional().nullable(),
  instrument: z.string().min(1).max(40),
  broker_symbol: z.string().max(40).optional().nullable(),
  direction: z.string().min(1).max(20),
  setup_type: z.string().max(80).optional().nullable(),
  timeframe: z.string().max(20).optional().nullable(),
  entry_zone_low: z.number().optional().nullable(),
  entry_zone_high: z.number().optional().nullable(),
  stop_loss: z.number().optional().nullable(),
  targets: z.array(z.union([z.number(), z.string()])).max(10).optional(),
  rr_tp1: z.number().optional().nullable(),
  score: z.number().min(0).max(100).optional().nullable(),
  grade: z.enum(["A_PLUS", "A", "B"]).optional().nullable(),
  score_components: z.record(z.string(), z.unknown()).optional(),
  reasons: z.array(z.string().max(400)).max(50).optional(),
  rejection_reasons: z.array(z.string().max(400)).max(50).optional(),
  invalidation: z.string().max(600).optional().nullable(),
  macro_context: z.record(z.string(), z.unknown()).optional(),
  spread: z.number().optional().nullable(),
  is_actionable: z.boolean().optional(),
  status: z.string().max(30).optional(),
  rulebook_version: z.string().max(40).optional().nullable(),
  signal_time_utc: z.string().optional(),
  expires_at_utc: z.string().optional().nullable(),
  trading_day_utc: z.string().optional(),
  scanner_run_id: z.string().uuid().optional().nullable(),
});

export const Route = createFileRoute("/api/public/ingest/signal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.P_TRADES_INGEST_SECRET;
        if (!secret) return new Response("Ingestion not configured", { status: 503 });
        if (request.headers.get("x-ptrades-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const parsed = signalSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid payload" }, { status: 400 });
        }
        const payload = parsed.data;

        // B-grade records are stored for the journal but can never be actionable.
        const isActionable =
          payload.grade === "A_PLUS" || payload.grade === "A" ? (payload.is_actionable ?? false) : false;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("signals")
          .upsert(
            {
              ...payload,
              targets: payload.targets ?? [],
              reasons: payload.reasons ?? [],
              rejection_reasons: payload.rejection_reasons ?? [],
              score_components: payload.score_components ?? {},
              macro_context: payload.macro_context ?? {},
              is_actionable: isActionable,
            },
            { onConflict: "external_id", ignoreDuplicates: false },
          )
          .select("id")
          .maybeSingle();

        if (error) {
          console.error("signal ingest failed", error.message);
          return Response.json({ error: "Ingestion failed" }, { status: 500 });
        }
        return Response.json({ ok: true, id: data?.id ?? null });
      },
    },
  },
});
