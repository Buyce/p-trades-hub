/**
 * Scanner heartbeat. Written on every scan attempt, success or failure, so the
 * dashboard can always tell whether the cloud scanner is alive.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export async function writeHeartbeat(
  admin: Admin,
  payload: {
    status: "OK" | "DEGRADED" | "ERROR" | "IDLE";
    metaapiConnected: boolean | null;
    rulebookVersion: string | null;
    detail: Record<string, unknown>;
  },
) {
  const { error } = await admin.from("system_heartbeats").insert({
    source: "cloud-scanner",
    status: payload.status,
    mt5_connected: payload.metaapiConnected,
    rulebook_version: payload.rulebookVersion,
    detail: payload.detail as never,
  });
  if (error) console.error("heartbeat insert failed", error.message);
}
