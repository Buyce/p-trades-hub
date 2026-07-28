/**
 * Scanner heartbeats.
 *
 * Each scheduled component writes its own heartbeat on EVERY outcome —
 * success, partial success, skipped because another pass held the lock, and
 * error. A component that is alive but idle must still prove it is alive,
 * because "no heartbeat" and "nothing to do" are completely different faults
 * and the dashboard cannot tell them apart from silence.
 */

import {
  HEARTBEAT_SOURCES,
  heartbeatHealth,
  type HeartbeatSource,
} from "@/lib/ptrades/heartbeat-health";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

// Freshness rules live in one client-safe module so the dashboard and the
// scanner can never disagree about what "alive" means.
export { HEARTBEAT_SOURCES, heartbeatHealth };
export type { HeartbeatSource };

export type HeartbeatStatus = "OK" | "DEGRADED" | "ERROR" | "IDLE" | "SKIPPED";

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
