/**
 * Distributed run lock. The scanner is scheduled once per minute; a slow run
 * must never overlap the next one, because overlapping runs can double-count
 * the daily actionable cap. The lock lives in Postgres so it survives across
 * stateless worker invocations.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const SCAN_LOCK_KEY = "scan-markets";

export async function acquireScanLock(
  admin: Admin,
  opts: { key?: string; ttlSeconds?: number; holder?: string } = {},
): Promise<boolean> {
  const { data, error } = await admin.rpc("acquire_scanner_lock", {
    _key: opts.key ?? SCAN_LOCK_KEY,
    _ttl_seconds: opts.ttlSeconds ?? 120,
    _holder: opts.holder ?? null,
  });
  if (error) {
    console.error("acquire_scanner_lock failed", error.message);
    // Fail closed: if the lock cannot be evaluated we do not run.
    return false;
  }
  return data === true;
}

export async function releaseScanLock(admin: Admin, key = SCAN_LOCK_KEY): Promise<void> {
  const { error } = await admin.rpc("release_scanner_lock", { _key: key });
  if (error) console.error("release_scanner_lock failed", error.message);
}
