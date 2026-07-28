/**
 * Alert delivery for a qualified signal. Three channels, all best-effort:
 *   1. In-app notification row (always written — it is the record of the alert)
 *   2. Browser push, per device, when the user has push enabled
 *   3. Email, when the user has email alerts enabled
 *
 * In SHADOW MODE nothing is delivered on any channel.
 */

import { sendPushToUsers } from "./push.server";
import { sendAlertEmail, type AlertEmailInput } from "./alert-email.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const SITE_URL = "https://p-trade-spotlight.lovable.app";

export type QualifiedAlert = {
  shadowMode: boolean;
  signalId: string;
  instrument: string;
  direction: string;
  grade: string | null;
  setupType: string | null;
  timeframe: string | null;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  stopLoss: number | null;
  targets: number[];
  rr: number | null;
  score: number | null;
  reasons: string[];
};

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

function zone(low: number | null, high: number | null): string {
  if (low === null && high === null) return "—";
  if (low !== null && high !== null && low !== high) return `${low} – ${high}`;
  return num(low ?? high);
}

export async function notifyQualifiedSignal(
  admin: Admin,
  alert: QualifiedAlert,
): Promise<{ sent: number; push: number; emails: number; suppressed: boolean }> {
  if (alert.shadowMode) {
    return { sent: 0, push: 0, emails: 0, suppressed: true };
  }

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, email_alerts_enabled, push_alerts_enabled");

  if (error || !profiles?.length) {
    if (error) console.error("notification recipients lookup failed", error.message);
    return { sent: 0, push: 0, emails: 0, suppressed: false };
  }

  const title = `${alert.instrument} ${alert.direction} — ${alert.grade ?? "graded"}`;
  const body = alert.rr
    ? `Qualified setup with ${alert.rr.toFixed(2)}R to TP1. You place the trade manually.`
    : "Qualified setup. You place the trade manually.";

  const { error: insertError } = await admin.from("notifications").insert(
    profiles.map((p) => ({
      user_id: p.id,
      signal_id: alert.signalId,
      title,
      body,
    })),
  );
  if (insertError) console.error("notification insert failed", insertError.message);

  // Push
  const pushUsers = profiles.filter((p) => p.push_alerts_enabled !== false).map((p) => p.id);
  const push = await sendPushToUsers(admin, pushUsers, {
    title,
    body,
    url: `${SITE_URL}/signals/${alert.signalId}`,
    tag: `signal-${alert.signalId}`,
  }).catch(() => ({ sent: 0, pruned: 0 }));

  // Email
  const emailInput: AlertEmailInput = {
    signalId: alert.signalId,
    instrument: alert.instrument,
    direction: alert.direction,
    grade: alert.grade ?? "—",
    setupType: alert.setupType ?? "—",
    timeframe: alert.timeframe ?? "—",
    entryZone: zone(alert.entryZoneLow, alert.entryZoneHigh),
    stopLoss: num(alert.stopLoss),
    targets: alert.targets.map((t) => String(t)),
    rrTp1: alert.rr === null ? "—" : `${alert.rr.toFixed(2)}R`,
    score: alert.score === null ? "—" : String(Math.round(alert.score)),
    reasons: alert.reasons,
  };

  let emails = 0;
  for (const profile of profiles.filter((p) => p.email_alerts_enabled)) {
    try {
      const { data: user } = await admin.auth.admin.getUserById(profile.id);
      const address = user?.user?.email;
      if (!address) continue;
      if (await sendAlertEmail(address, emailInput)) emails += 1;
    } catch (emailError) {
      console.error(
        "alert email lookup failed",
        emailError instanceof Error ? emailError.message : "unknown",
      );
    }
  }

  return { sent: profiles.length, push: push.sent, emails, suppressed: false };
}
