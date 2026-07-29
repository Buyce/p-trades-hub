/**
 * Distributed run lock. The scanner is scheduled once per minute; a slow run
 * must never overlap the next one, because overlapping runs duplicate broker
 * reads and corrupt run telemetry. The lock lives in Postgres so it survives
 * across stateless worker invocations.
 *
 * Ownership is explicit: every invocation generates a unique holder token, and
 * only that holder may release or renew the lock. Without it a slow run
 * releases the lock a faster successor is already holding, and the two runs
 * race.
 *
 * Takeover of an EXPIRED lock is atomic and happens inside
 * `acquire_scanner_lock`: the conditional upsert only updates the row when
 * `expires_at < now()`, so exactly one of two simultaneous callers wins.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const SCAN_LOCK_KEY = "scan-markets";
export const SYNC_LOCK_KEY = "sync-market-data";
export const PRECISION_LOCK_KEY = "scan-precision";

/** A unique owner token for one invocation. */
export function newLockHolder(prefix = "run"): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${uuid}`;
}

export async function acquireScanLock(
  admin: Admin,
  opts: { key?: string; ttlSeconds?: number; holder?: string } = {},
): Promise<boolean> {
  const { data, error } = await admin.rpc("acquire_scanner_lock", {
    _key: opts.key ?? SCAN_LOCK_KEY,
    _ttl_seconds: opts.ttlSeconds ?? 120,
    _holder: opts.holder ?? newLockHolder(),
  });
  if (error) {
    console.error("acquire_scanner_lock failed", error.message);
    // Fail closed: if the lock cannot be evaluated we do not run.
    return false;
  }
  return data === true;
}

/**
 * Extends the lease of a lock this invocation still owns. A long but healthy
 * run must not have its lock stolen mid-flight, and a dead run must not keep
 * one — renewing only while alive gives us both.
 */
export async function renewScanLock(
  admin: Admin,
  key: string,
  holder: string,
  ttlSeconds = 120,
): Promise<boolean> {
  const { data, error } = await admin.rpc("renew_scanner_lock", {
    _key: key,
    _holder: holder,
    _ttl_seconds: ttlSeconds,
  });
  if (error) {
    console.error("renew_scanner_lock failed", error.message);
    return false;
  }
  return data === true;
}

/**
 * Releases the lock only when `holder` still owns it. Passing no holder keeps
 * the old unconditional behaviour for callers that have not been migrated.
 */
export async function releaseScanLock(
  admin: Admin,
  key = SCAN_LOCK_KEY,
  holder?: string,
): Promise<void> {
  const { error } = await admin.rpc("release_scanner_lock", {
    _key: key,
    _holder: holder ?? null,
  });
  if (error) console.error("release_scanner_lock failed", error.message);
}

/** Current lock row, for health telemetry. */
export async function readLock(
  admin: Admin,
  key: string,
): Promise<{ holder: string | null; lockedAt: string | null; expiresAt: string | null; ageSeconds: number | null }> {
  const { data } = await admin
    .from("scanner_locks")
    .select("holder, locked_at, expires_at")
    .eq("lock_key", key)
    .maybeSingle();
  const lockedAtMs = data?.locked_at ? Date.parse(data.locked_at) : null;
  return {
    holder: data?.holder ?? null,
    lockedAt: data?.locked_at ?? null,
    expiresAt: data?.expires_at ?? null,
    ageSeconds: lockedAtMs ? Math.round((Date.now() - lockedAtMs) / 1000) : null,
  };
}

/**
 * Hard runtime deadline. A pass checks this between units of work and stops
 * cleanly instead of being killed mid-write and leaving a lock behind.
 */
export function createDeadline(budgetMs: number) {
  const startedAt = Date.now();
  return {
    startedAt,
    elapsedMs: () => Date.now() - startedAt,
    remainingMs: () => Math.max(0, budgetMs - (Date.now() - startedAt)),
    expired: () => Date.now() - startedAt >= budgetMs,
  };
}
