/**
 * Distributed run lock. The scanner is scheduled once per minute; a slow run
 * must never overlap the next one, because overlapping runs duplicate broker
 * reads and corrupt run telemetry. The lock lives in Postgres so it survives
 * across stateless worker invocations.
 *
 * Ownership is explicit: every invocation generates a unique holder UUID, and
 * only that holder may release the lock. Without it a slow run releases the
 * lock a faster successor is already holding, and the two runs race.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const SCAN_LOCK_KEY = "scan-markets";

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
