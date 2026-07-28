/**
 * Scanner heartbeats.
 *
 * Each scheduled component writes its own heartbeat on EVERY outcome —
 * success, partial success, skipped because another pass held the lock, and
 * error. A component that is alive but idle must still prove it is alive,
 * because "no heartbeat" and "nothing to do" are completely different faults
 * and the dashboard cannot tell them apart from silence.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** The scheduled components that report liveness independently. */
export const HEARTBEAT_SOURCES = ["CONTEXT_SCANNER", "PRECISION_SCANNER"] as const;

export type HeartbeatSource = (typeof HEARTBEAT_SOURCES)[number];

export type HeartbeatStatus = "OK" | "DEGRADED" | "ERROR" | "IDLE" | "SKIPPED";

/** Freshness bands. A component is only healthy inside one scheduler tick. */
export const HEARTBEAT_HEALTHY_MS = 2 * 60_000;
export const HEARTBEAT_DEGRADED_MS = 5 * 60_000;

export type HeartbeatHealth = "HEALTHY" | "DEGRADED" | "OFFLINE" | "UNKNOWN";

/**
 * Liveness is derived from heartbeat AGE, never from the status word stored in
 * the last row. A thirteen-minute-old "OK" is an offline scanner.
 */
export function heartbeatHealth(receivedAt: string | null | undefined, nowMs = Date.now()): HeartbeatHealth {
  if (!receivedAt) return "UNKNOWN";
  const age = nowMs - new Date(receivedAt).getTime();
  if (!Number.isFinite(age)) return "UNKNOWN";
  if (age < HEARTBEAT_HEALTHY_MS) return "HEALTHY";
  if (age < HEARTBEAT_DEGRADED_MS) return "DEGRADED";
  return "OFFLINE";
}

export async function writeHeartbeat(
  admin: Admin,
  payload: {
    source?: HeartbeatSource | string;
    status: HeartbeatStatus;
    metaapiConnected: boolean | null;
    rulebookVersion: string | null;
    detail: Record<string, unknown>;
  },
) {
  const { error } = await admin.from("system_heartbeats").insert({
    source: payload.source ?? "CONTEXT_SCANNER",
    status: payload.status,
    mt5_connected: payload.metaapiConnected,
    rulebook_version: payload.rulebookVersion,
    detail: payload.detail as never,
  });
  if (error) console.error("heartbeat insert failed", error.message);
}

/** Never let a heartbeat failure take down the pass that was reporting health. */
export async function safeHeartbeat(
  admin: Admin,
  payload: Parameters<typeof writeHeartbeat>[1],
): Promise<void> {
  try {
    await writeHeartbeat(admin, payload);
  } catch (error) {
    console.error("heartbeat write threw", error instanceof Error ? error.message : error);
  }
}
