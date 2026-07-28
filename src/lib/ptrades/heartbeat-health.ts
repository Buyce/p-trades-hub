/**
 * Heartbeat freshness. Client-safe on purpose: the dashboard must derive
 * liveness the same way the scanner reports it, and a browser cannot import
 * a *.server module.
 *
 * Liveness is derived from AGE, never from the status word on the last stored
 * row. A thirteen-minute-old "OK" is an offline scanner, and showing it as OK
 * is how a dead runtime stayed invisible.
 */

export const HEARTBEAT_SOURCES = ["CONTEXT_SCANNER", "PRECISION_SCANNER"] as const;

export type HeartbeatSource = (typeof HEARTBEAT_SOURCES)[number];

export const HEARTBEAT_SOURCE_LABEL: Record<string, string> = {
  CONTEXT_SCANNER: "Context scan (M15 detection)",
  PRECISION_SCANNER: "Precision pass (M1 execution)",
  "cloud-scanner": "Legacy combined scanner",
};

/** Both components are scheduled once a minute. */
export const HEARTBEAT_HEALTHY_MS = 2 * 60_000;
export const HEARTBEAT_DEGRADED_MS = 5 * 60_000;

export type HeartbeatHealth = "HEALTHY" | "DEGRADED" | "OFFLINE" | "UNKNOWN";

export function heartbeatHealth(
  receivedAt: string | null | undefined,
  nowMs: number = Date.now(),
): HeartbeatHealth {
  if (!receivedAt) return "UNKNOWN";
  const age = nowMs - new Date(receivedAt).getTime();
  if (!Number.isFinite(age)) return "UNKNOWN";
  if (age < HEARTBEAT_HEALTHY_MS) return "HEALTHY";
  if (age < HEARTBEAT_DEGRADED_MS) return "DEGRADED";
  return "OFFLINE";
}

export function heartbeatPillState(health: HeartbeatHealth): "ok" | "warn" | "down" | "idle" {
  if (health === "HEALTHY") return "ok";
  if (health === "DEGRADED") return "warn";
  if (health === "OFFLINE") return "down";
  return "idle";
}

export function heartbeatLabel(health: HeartbeatHealth): string {
  if (health === "HEALTHY") return "Live";
  if (health === "DEGRADED") return "Late";
  if (health === "OFFLINE") return "Not reporting";
  return "No heartbeat";
}
