/**
 * Heartbeat freshness. Client-safe on purpose: the dashboard must derive
 * liveness the same way the scanner reports it, and a browser cannot import
 * a *.server module.
 *
 * Liveness is derived from both AGE and the component's reported outcome. A
 * thirteen-minute-old "OK" is offline, while a fresh "ERROR" is failed rather
 * than live. Both dimensions are required to avoid false-green dashboards.
 */

export const HEARTBEAT_SOURCES = [
  "MARKET_DATA_SYNC",
  "CONTEXT_SCANNER",
  "PRECISION_SCANNER",
] as const;

export type HeartbeatSource = (typeof HEARTBEAT_SOURCES)[number];

/**
 * Components displayed by the cockpit. Alert delivery deliberately is not a
 * scanner job: keeping it out of HEARTBEAT_SOURCES prevents the scanner lock
 * watchdog from treating the outbox worker as a market-analysis process.
 */
export const COMPONENT_HEARTBEAT_SOURCES = [...HEARTBEAT_SOURCES, "ALERT_DELIVERY"] as const;

export type ComponentHeartbeatSource = (typeof COMPONENT_HEARTBEAT_SOURCES)[number];

export const HEARTBEAT_SOURCE_LABEL: Record<string, string> = {
  MARKET_DATA_SYNC: "Market data sync (candle store)",
  CONTEXT_SCANNER: "Context scan (M15 detection)",
  PRECISION_SCANNER: "Precision pass (M1 execution)",
  ALERT_DELIVERY: "Alert delivery (in-app, push and email)",
  "cloud-scanner": "Legacy combined scanner",
};

/** Runtime components are scheduled once a minute. */
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

/**
 * Health of one scheduled component. Timestamp freshness proves that the
 * scheduler called the worker; the outcome proves that the worker succeeded.
 */
export function componentHeartbeatHealth(
  receivedAt: string | null | undefined,
  status: string | null | undefined,
  nowMs: number = Date.now(),
): HeartbeatHealth {
  const freshness = heartbeatHealth(receivedAt, nowMs);
  if (freshness === "OFFLINE" || freshness === "UNKNOWN") return freshness;

  const outcome = status?.trim().toUpperCase();
  if (outcome === "ERROR") return "OFFLINE";
  if (outcome === "DEGRADED" || outcome === "SKIPPED") return "DEGRADED";
  if (outcome === "OK" || outcome === "IDLE") return freshness;

  // A fresh row with no recognised outcome only proves invocation, not work.
  return "DEGRADED";
}

/** The cockpit is live only when every required runtime component is live. */
export function aggregateHeartbeatHealth(components: HeartbeatHealth[]): HeartbeatHealth {
  if (components.length === 0) return "UNKNOWN";
  if (components.some((health) => health === "OFFLINE")) return "OFFLINE";
  if (components.some((health) => health === "UNKNOWN")) return "UNKNOWN";
  if (components.some((health) => health === "DEGRADED")) return "DEGRADED";
  return "HEALTHY";
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

/**
 * Context-scan liveness. A SKIPPED heartbeat proves the scheduler fired, NOT
 * that a scan completed: a wedged run can emit fresh SKIPPED heartbeats for
 * hours while nothing is ever evaluated. Liveness therefore depends on the last
 * COMPLETED context scan as well as heartbeat freshness.
 */
export const CONTEXT_SUCCESS_OFFLINE_MS = 5 * 60_000;
export const CONTEXT_SKIP_STREAK_DEGRADED = 3;

export type ContextRuntime = {
  health: HeartbeatHealth;
  reason: string;
  skipStreak: number;
  lastSuccessAt: string | null;
  lastSuccessAgeMs: number | null;
};

export function contextRuntimeHealth(
  input: {
    latestAt: string | null | undefined;
    latestStatus?: string | null;
    /** Newest-first statuses for the context scanner. */
    recentStatuses?: string[];
    lastSuccessAt?: string | null;
  },
  nowMs: number = Date.now(),
): ContextRuntime {
  const base = heartbeatHealth(input.latestAt, nowMs);
  let skipStreak = 0;
  for (const status of input.recentStatuses ?? []) {
    if (status === "SKIPPED") skipStreak += 1;
    else break;
  }
  const lastSuccessAt = input.lastSuccessAt ?? null;
  const lastSuccessAgeMs = lastSuccessAt ? nowMs - new Date(lastSuccessAt).getTime() : null;

  if (base === "OFFLINE" || base === "UNKNOWN") {
    return {
      health: base,
      reason: base === "OFFLINE" ? "No context heartbeat." : "No heartbeat recorded.",
      skipStreak,
      lastSuccessAt,
      lastSuccessAgeMs,
    };
  }

  const latestStatus = input.latestStatus?.trim().toUpperCase();
  if (latestStatus === "ERROR") {
    return {
      health: "OFFLINE",
      reason: "The latest context scan failed.",
      skipStreak,
      lastSuccessAt,
      lastSuccessAgeMs,
    };
  }

  if (latestStatus === "DEGRADED") {
    return {
      health: "DEGRADED",
      reason: "The latest context scan completed with degraded data or runtime health.",
      skipStreak,
      lastSuccessAt,
      lastSuccessAgeMs,
    };
  }

  if (lastSuccessAgeMs === null || lastSuccessAgeMs > CONTEXT_SUCCESS_OFFLINE_MS) {
    return {
      health: "OFFLINE",
      reason:
        lastSuccessAgeMs === null
          ? "No context scan has completed."
          : `No context scan has completed for ${Math.round(lastSuccessAgeMs / 60_000)} min.`,
      skipStreak,
      lastSuccessAt,
      lastSuccessAgeMs,
    };
  }

  if (skipStreak >= CONTEXT_SKIP_STREAK_DEGRADED) {
    return {
      health: "DEGRADED",
      reason: `${skipStreak} consecutive scheduler ticks skipped — a previous run still holds the lock.`,
      skipStreak,
      lastSuccessAt,
      lastSuccessAgeMs,
    };
  }

  return {
    health: base,
    reason: "Context scans completing on schedule.",
    skipStreak,
    lastSuccessAt,
    lastSuccessAgeMs,
  };
}
