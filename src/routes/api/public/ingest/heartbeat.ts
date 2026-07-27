import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";

const heartbeatSchema = z.object({
  source: z.string().min(1).max(80),
  status: z.string().min(1).max(40),
  mt5_connected: z.boolean().optional().nullable(),
  rulebook_version: z.string().max(40).optional().nullable(),
  detail: z.record(z.string(), z.unknown()).optional(),
  run: z
    .object({
      started_at: z.string().optional(),
      finished_at: z.string().optional().nullable(),
      status: z.string().max(30).optional(),
      symbols_scanned: z.array(z.string().max(40)).max(50).optional(),
      signals_emitted: z.number().int().min(0).optional(),
      rejections: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
      error_message: z.string().max(1000).optional().nullable(),
      rulebook_version: z.string().max(40).optional().nullable(),
    })
    .optional(),
});

export const Route = createFileRoute("/api/public/ingest/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.P_TRADES_INGEST_SECRET;
        if (!secret) return new Response("Ingestion not configured", { status: 503 });
        if (request.headers.get("x-ptrades-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const parsed = heartbeatSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid payload" }, { status: 400 });
        }
        const { run, ...heartbeat } = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { error: heartbeatError } = await supabaseAdmin.from("system_heartbeats").insert({
          source: heartbeat.source,
          status: heartbeat.status,
          mt5_connected: heartbeat.mt5_connected ?? null,
          rulebook_version: heartbeat.rulebook_version ?? null,
          detail: (heartbeat.detail ?? {}) as Json,
        });
        if (heartbeatError) {
          console.error("heartbeat ingest failed", heartbeatError.message);
          return Response.json({ error: "Ingestion failed" }, { status: 500 });
        }

        let runId: string | null = null;
        if (run) {
          const { data, error } = await supabaseAdmin
            .from("scanner_runs")
            .insert({
              started_at: run.started_at,
              finished_at: run.finished_at ?? null,
              status: run.status ?? "SUCCESS",
              symbols_scanned: run.symbols_scanned ?? [],
              signals_emitted: run.signals_emitted ?? 0,
              rejections: (run.rejections ?? []) as Json,
              error_message: run.error_message ?? null,
              rulebook_version: run.rulebook_version ?? null,
            })
            .select("id")
            .maybeSingle();
          if (error) {
            console.error("scanner run ingest failed", error.message);
          } else {
            runId = data?.id ?? null;
          }
        }

        return Response.json({ ok: true, scanner_run_id: runId });
      },
    },
  },
});
