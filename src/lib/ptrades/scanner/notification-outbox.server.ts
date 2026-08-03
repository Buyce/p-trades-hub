import type { Database, Json } from "@/integrations/supabase/types";
import { notifyQualifiedSignal, type QualifiedAlert } from "./notify.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];
type OutboxRow = Database["public"]["Tables"]["notification_outbox"]["Row"];

export type OutboxDeliverySummary = {
  claimed: number;
  sent: number;
  retried: number;
  deadLetter: number;
  errors: string[];
};

const MAX_ATTEMPTS = 8;

function object(value: Json): Record<string, Json> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Notification outbox payload is not an object.");
  }
  return value as Record<string, Json>;
}

function requiredString(payload: Record<string, Json>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Notification outbox payload is missing ${key}.`);
  }
  return value;
}

function nullableNumber(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Runtime boundary for database-created payloads. Malformed events retry and
 * ultimately dead-letter instead of silently producing a partial alert. */
export function parseOutboxAlert(value: Json): QualifiedAlert {
  const payload = object(value);
  return {
    shadowMode: payload.shadowMode === true,
    signalId: requiredString(payload, "signalId"),
    instrument: requiredString(payload, "instrument"),
    direction: requiredString(payload, "direction"),
    grade: typeof payload.grade === "string" ? payload.grade : null,
    setupType: typeof payload.setupType === "string" ? payload.setupType : null,
    timeframe: typeof payload.timeframe === "string" ? payload.timeframe : null,
    entryZoneLow: nullableNumber(payload.entryZoneLow),
    entryZoneHigh: nullableNumber(payload.entryZoneHigh),
    stopLoss: nullableNumber(payload.stopLoss),
    targets: Array.isArray(payload.targets)
      ? payload.targets.filter((item): item is number => typeof item === "number")
      : [],
    rr: nullableNumber(payload.rr),
    score: nullableNumber(payload.score),
    reasons: Array.isArray(payload.reasons)
      ? payload.reasons.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function retryAt(attempt: number, nowMs: number): string {
  const delaySeconds = Math.min(30 * 60, 15 * 2 ** Math.max(0, attempt - 1));
  return new Date(nowMs + delaySeconds * 1_000).toISOString();
}

async function claim(admin: Admin, row: OutboxRow, holder: string): Promise<OutboxRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("notification_outbox")
    .update({
      status: "PROCESSING",
      locked_at: now,
      locked_by: holder,
      updated_at: now,
    })
    .eq("id", row.id)
    .in("status", ["PENDING", "FAILED_RETRYABLE"])
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Notification outbox claim failed: ${error.message}`);
  return data as OutboxRow | null;
}

/**
 * Delivers durable notification events. The signal transition and event insert
 * are one database transaction; this worker may crash at any later point and
 * the event remains retryable. In-app writes and email sends are idempotent.
 */
export async function drainNotificationOutbox(
  admin: Admin,
  options: { limit?: number; now?: () => number } = {},
): Promise<OutboxDeliverySummary> {
  const nowMs = options.now?.() ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const holder = `notification:${crypto.randomUUID()}`;
  const summary: OutboxDeliverySummary = {
    claimed: 0,
    sent: 0,
    retried: 0,
    deadLetter: 0,
    errors: [],
  };

  // A killed worker cannot strand an event forever.
  const { error: recoveryError } = await admin
    .from("notification_outbox")
    .update({
      status: "FAILED_RETRYABLE",
      locked_at: null,
      locked_by: null,
      available_at: now,
      last_error: "Recovered after a stale processing lease.",
      updated_at: now,
    })
    .eq("status", "PROCESSING")
    .lt("locked_at", new Date(nowMs - 5 * 60_000).toISOString());
  if (recoveryError) {
    throw new Error(`Notification outbox lease recovery failed: ${recoveryError.message}`);
  }

  const { data, error } = await admin
    .from("notification_outbox")
    .select("*")
    .in("status", ["PENDING", "FAILED_RETRYABLE"])
    .lte("available_at", now)
    .order("created_at", { ascending: true })
    .limit(options.limit ?? 25);
  if (error) throw new Error(`Notification outbox read failed: ${error.message}`);

  for (const pending of (data ?? []) as OutboxRow[]) {
    let row: OutboxRow | null = null;
    try {
      row = await claim(admin, pending, holder);
      if (!row) continue;
      summary.claimed += 1;
      await notifyQualifiedSignal(admin, parseOutboxAlert(row.payload));
      const finished = new Date().toISOString();
      const { error: sentError } = await admin
        .from("notification_outbox")
        .update({
          status: "SENT",
          sent_at: finished,
          locked_at: null,
          locked_by: null,
          last_error: null,
          updated_at: finished,
        })
        .eq("id", row.id)
        .eq("locked_by", holder);
      if (sentError) throw new Error(`Notification outbox completion failed: ${sentError.message}`);
      summary.sent += 1;
    } catch (deliveryError) {
      const message =
        deliveryError instanceof Error ? deliveryError.message : "Unknown delivery error";
      summary.errors.push(`${pending.signal_id}: ${message}`);
      if (!row) continue;
      const attempts = row.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      const failedAt = new Date().toISOString();
      const { error: retryError } = await admin
        .from("notification_outbox")
        .update({
          status: dead ? "DEAD_LETTER" : "FAILED_RETRYABLE",
          attempts,
          available_at: dead ? row.available_at : retryAt(attempts, nowMs),
          locked_at: null,
          locked_by: null,
          last_error: message.slice(0, 2_000),
          updated_at: failedAt,
        })
        .eq("id", row.id)
        .eq("locked_by", holder);
      if (retryError) {
        throw new Error(`Notification outbox retry update failed: ${retryError.message}`);
      }
      if (dead) summary.deadLetter += 1;
      else summary.retried += 1;
    }
  }

  return summary;
}
