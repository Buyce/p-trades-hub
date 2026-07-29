/**
 * Execution watchdog.
 *
 * The precision engine can be silently unreachable: setups arm all day, every
 * one of them expires, and the terminal looks identical to a quiet market. This
 * detects that state — armed setups with no ENTRY_READY over a long window —
 * and raises one alert per cooldown period. It never changes a rule, a signal
 * or a watch; it only reports.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const ACTION = "PRECISION_STALL_ALERT";

export type WatchdogResult = {
  armed: number;
  entryReady: number;
  stalled: boolean;
  alerted: boolean;
};

export async function checkExecutionStall(
  admin: Admin,
  options: { stallMinutes?: number; cooldownHours?: number; now?: Date } = {},
): Promise<WatchdogResult> {
  const stallMinutes = options.stallMinutes ?? 180;
  const cooldownHours = options.cooldownHours ?? 6;
  const now = options.now ?? new Date();
  const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;

  const { data: watches } = await admin
    .from("precision_watches")
    .select("id, armed_at, entry_ready_at, symbol, state")
    .gte("armed_at", dayStart)
    .limit(1000);

  const rows = (watches ?? []) as Array<{
    armed_at: string;
    entry_ready_at: string | null;
    symbol: string;
  }>;
  const armed = rows.length;
  const entryReady = rows.filter((r) => r.entry_ready_at !== null).length;

  const oldestArmedMs = rows.reduce<number | null>((m, r) => {
    const t = Date.parse(r.armed_at);
    return Number.isFinite(t) && (m === null || t < m) ? t : m;
  }, null);

  const stalled =
    armed > 0 &&
    entryReady === 0 &&
    oldestArmedMs !== null &&
    now.getTime() - oldestArmedMs >= stallMinutes * 60_000;

  if (!stalled) return { armed, entryReady, stalled: false, alerted: false };

  // Cooldown: one alert per window, so a quiet afternoon cannot spam.
  const since = new Date(now.getTime() - cooldownHours * 3_600_000).toISOString();
  const { data: recent } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", ACTION)
    .gte("created_at", since)
    .limit(1);

  if ((recent ?? []).length > 0) return { armed, entryReady, stalled: true, alerted: false };

  await admin.from("audit_log").insert({
    actor_kind: "SYSTEM",
    action: ACTION,
    entity_type: "precision_watches",
    detail: {
      armed,
      entry_ready: entryReady,
      stall_minutes: stallMinutes,
      oldest_armed_at: oldestArmedMs ? new Date(oldestArmedMs).toISOString() : null,
      symbols: [...new Set(rows.map((r) => r.symbol))],
    },
  });

  // Tell the operators, not every trader: this is a system condition.
  const { data: staff } = await admin
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["owner", "admin"]);

  const recipients = [...new Set(((staff ?? []) as Array<{ user_id: string }>).map((s) => s.user_id))];
  if (recipients.length > 0) {
    await admin.from("notifications").insert(
      recipients.map((user_id) => ({
        user_id,
        title: "Execution stall detected",
        body: `${armed} setups armed today and none reached entry-ready in ${Math.round(stallMinutes / 60)}h. Check the execution funnel on Scanner health.`,
      })),
    );
  }

  return { armed, entryReady, stalled: true, alerted: true };
}
