/**
 * Scheduler progress watchdog.
 *
 * The execution watchdog (`watchdog.server.ts`) answers "setups arm but never
 * execute". This one answers the failure UNDERNEATH that: a scheduled job that
 * stops making progress at all — timing out, erroring every tick, or skipping
 * every tick because a dead invocation left its lock behind until the TTL
 * lapses.
 *
 * Progress is measured as a COMPLETED pass, never as a heartbeat: a wedged job
 * emits fresh SKIPPED heartbeats forever while nothing is evaluated.
 *
 * It reports only. It never touches a lock, a rule, a signal or a watch —
 * clearing a lock here would race the invocation that legitimately owns it.
 */

import { HEARTBEAT_SOURCES, type HeartbeatSource } from "@/lib/ptrades/heartbeat-health";
import { PRECISION_LOCK_KEY, SCAN_LOCK_KEY, SYNC_LOCK_KEY } from "./lock.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const JOB_PROGRESS_ACTION = "JOB_PROGRESS_ALERT";

/** Every job is scheduled once a minute, so these are generous multiples. */
export const NO_HEARTBEAT_MS = 5 * 60_000;
export const NO_PROGRESS_MS = 10 * 60_000;
export const SKIP_STREAK_LIMIT = 5;
export const ERROR_STREAK_LIMIT = 3;
/** A lock whose lease lapsed this long ago was left by a killed invocation. */
export const LOCK_OVERRUN_MS = 2 * 60_000;

const LOCK_KEY_FOR_SOURCE: Record<HeartbeatSource, string> = {
  MARKET_DATA_SYNC: SYNC_LOCK_KEY,
  CONTEXT_SCANNER: SCAN_LOCK_KEY,
  PRECISION_SCANNER: PRECISION_LOCK_KEY,
};

const SOURCE_LABEL: Record<HeartbeatSource, string> = {
  MARKET_DATA_SYNC: "Market data sync",
  CONTEXT_SCANNER: "Context scan",
  PRECISION_SCANNER: "Precision pass",
};

/** A completed pass. SKIPPED proves only that the scheduler fired. */
const PROGRESS_STATUSES = new Set(["OK", "DEGRADED", "IDLE"]);

export type HeartbeatRow = { source: string; status: string; received_at: string };
export type LockRow = { lock_key: string; holder: string | null; expires_at: string };

export type JobFault = {
  source: HeartbeatSource;
  /** Machine-readable cause, stable enough to alert and group on. */
  code: "NO_HEARTBEAT" | "NO_PROGRESS" | "SKIP_STREAK" | "ERROR_STREAK" | "LOCK_OVERRUN";
  message: string;
  detail: Record<string, unknown>;
};

export type JobProgressReport = {
  jobs: Array<{
    source: HeartbeatSource;
    lastHeartbeatAt: string | null;
    lastProgressAt: string | null;
    skipStreak: number;
    errorStreak: number;
    lockExpiredForMs: number | null;
    healthy: boolean;
  }>;
  faults: JobFault[];
  alerted: JobFault[];
};

/**
 * Pure evaluation, so the alerting rules can be pinned by tests without a
 * database. `heartbeats` must be newest-first.
 */
export function evaluateJobProgress(
  heartbeats: HeartbeatRow[],
  locks: LockRow[],
  nowMs: number,
): Omit<JobProgressReport, "alerted"> {
  const jobs: JobProgressReport["jobs"] = [];
  const faults: JobFault[] = [];

  for (const source of HEARTBEAT_SOURCES) {
    const rows = heartbeats.filter((h) => h.source === source);
    const lastHeartbeatAt = rows[0]?.received_at ?? null;
    const lastProgress = rows.find((r) => PROGRESS_STATUSES.has(r.status)) ?? null;
    const lastProgressAt = lastProgress?.received_at ?? null;

    let skipStreak = 0;
    for (const r of rows) {
      if (r.status === "SKIPPED") skipStreak += 1;
      else break;
    }
    let errorStreak = 0;
    for (const r of rows) {
      if (r.status === "ERROR") errorStreak += 1;
      else break;
    }

    const lock = locks.find((l) => l.lock_key === LOCK_KEY_FOR_SOURCE[source]) ?? null;
    const expiredMs = lock ? nowMs - Date.parse(lock.expires_at) : null;
    const lockExpiredForMs = expiredMs !== null && expiredMs > 0 ? expiredMs : null;

    const heartbeatAge = lastHeartbeatAt ? nowMs - Date.parse(lastHeartbeatAt) : null;
    const progressAge = lastProgressAt ? nowMs - Date.parse(lastProgressAt) : null;
    const label = SOURCE_LABEL[source];
    const before: number = faults.length;

    if (heartbeatAge === null || heartbeatAge >= NO_HEARTBEAT_MS) {
      faults.push({
        source,
        code: "NO_HEARTBEAT",
        message:
          heartbeatAge === null
            ? `${label} has never reported. Its scheduled job is not running.`
            : `${label} has not reported for ${Math.round(heartbeatAge / 60_000)} min. Its scheduled job has stopped or is timing out.`,
        detail: { last_heartbeat_at: lastHeartbeatAt, age_ms: heartbeatAge },
      });
    } else if (progressAge === null || progressAge >= NO_PROGRESS_MS) {
      faults.push({
        source,
        code: "NO_PROGRESS",
        message:
          progressAge === null
            ? `${label} is reporting but has never completed a pass.`
            : `${label} has not completed a pass for ${Math.round(progressAge / 60_000)} min, even though the scheduler is still firing.`,
        detail: { last_progress_at: lastProgressAt, age_ms: progressAge },
      });
    }

    if (errorStreak >= ERROR_STREAK_LIMIT) {
      faults.push({
        source,
        code: "ERROR_STREAK",
        message: `${label} failed ${errorStreak} consecutive ticks.`,
        detail: { error_streak: errorStreak },
      });
    }
    if (skipStreak >= SKIP_STREAK_LIMIT) {
      faults.push({
        source,
        code: "SKIP_STREAK",
        message: `${label} skipped ${skipStreak} consecutive ticks — a previous run is still holding its lock.`,
        detail: { skip_streak: skipStreak, lock_key: LOCK_KEY_FOR_SOURCE[source] },
      });
    }
    if (lockExpiredForMs !== null && lockExpiredForMs >= LOCK_OVERRUN_MS) {
      faults.push({
        source,
        code: "LOCK_OVERRUN",
        message: `${label} lock lease lapsed ${Math.round(lockExpiredForMs / 60_000)} min ago and was never released — the invocation holding it died mid-pass.`,
        detail: {
          lock_key: LOCK_KEY_FOR_SOURCE[source],
          holder: lock?.holder ?? null,
          expires_at: lock?.expires_at ?? null,
          expired_for_ms: lockExpiredForMs,
        },
      });
    }

    jobs.push({
      source,
      lastHeartbeatAt,
      lastProgressAt,
      skipStreak,
      errorStreak,
      lockExpiredForMs,
      healthy: faults.length === before,
    });
  }

  return { jobs, faults };
}

/**
 * Reads current scheduler state and raises one staff alert per
 * source+cause per cooldown window. Best-effort: never throws into a pass.
 */
export async function checkJobProgress(
  admin: Admin,
  options: { cooldownMinutes?: number; now?: Date } = {},
): Promise<JobProgressReport> {
  const now = options.now ?? new Date();
  const cooldownMinutes = options.cooldownMinutes ?? 60;

  const [{ data: heartbeats }, { data: locks }] = await Promise.all([
    admin
      .from("system_heartbeats")
      .select("source, status, received_at")
      .gte("received_at", new Date(now.getTime() - 60 * 60_000).toISOString())
      .order("received_at", { ascending: false })
      .limit(400),
    admin.from("scanner_locks").select("lock_key, holder, expires_at"),
  ]);

  const report = evaluateJobProgress(
    (heartbeats ?? []) as HeartbeatRow[],
    (locks ?? []) as LockRow[],
    now.getTime(),
  );

  if (report.faults.length === 0) return { ...report, alerted: [] };

  // Cooldown: one alert per source+cause per window, so a job that is down for
  // an hour does not bury the operators in identical rows.
  const since = new Date(now.getTime() - cooldownMinutes * 60_000).toISOString();
  const { data: recent } = await admin
    .from("audit_log")
    .select("entity_id")
    .eq("action", JOB_PROGRESS_ACTION)
    .gte("created_at", since)
    .limit(200);
  const suppressed = new Set(
    ((recent ?? []) as Array<{ entity_id: string | null }>).map((r) => r.entity_id ?? ""),
  );

  const fresh = report.faults.filter((f) => !suppressed.has(`${f.source}:${f.code}`));
  if (fresh.length === 0) return { ...report, alerted: [] };

  await admin.from("audit_log").insert(
    fresh.map((f) => ({
      actor_kind: "SYSTEM",
      action: JOB_PROGRESS_ACTION,
      entity_type: "scheduled_job",
      entity_id: `${f.source}:${f.code}`,
      detail: { source: f.source, code: f.code, message: f.message, ...f.detail } as never,
    })),
  );

  // Operators, not traders: this is a system condition, not a setup.
  const { data: staff } = await admin
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["owner", "admin"]);
  const recipients = [
    ...new Set(((staff ?? []) as Array<{ user_id: string }>).map((s) => s.user_id)),
  ];

  if (recipients.length > 0) {
    await admin.from("notifications").insert(
      recipients.flatMap((user_id) =>
        fresh.map((f) => ({
          user_id,
          title: `Scanner job not progressing — ${SOURCE_LABEL[f.source]}`,
          body: f.message,
        })),
      ),
    );

    const { sendPushToUsers } = await import("./push.server");
    const first = fresh[0]!;
    await sendPushToUsers(admin, recipients, {
      title: `Scanner job not progressing — ${SOURCE_LABEL[first.source]}`,
      body:
        fresh.length > 1
          ? `${first.message} (+${fresh.length - 1} more scheduler fault${fresh.length > 2 ? "s" : ""})`
          : first.message,
      url: "https://getptrades.com/scanner-health",
      tag: `job-progress-${first.source}-${first.code}`,
    }).catch(() => undefined);
  }

  return { ...report, alerted: fresh };
}
