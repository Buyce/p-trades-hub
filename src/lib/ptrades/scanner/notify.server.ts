/**
 * Alert delivery for a qualified signal. Three channels:
 *   1. In-app notification row (durable and idempotent — the alert record)
 *   2. Browser push, per device, when the user has push enabled
 *   3. Email, when the user has email alerts enabled
 *
 * In SHADOW MODE nothing is delivered on any channel.
 */

import {
  DEFAULT_EMAIL_TIERS,
  DEFAULT_PUSH_TIERS,
  isTier,
  parseTiers,
  tierLabel,
  type Tier,
} from "../tiers";
import { sendPushToUsers } from "./push.server";
import { sendAlertEmail, type AlertEmailInput } from "./alert-email.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const SITE_URL = "https://getptrades.com";

export type QualifiedAlert = {
  shadowMode: boolean;
  /**
   * Delivery test. The payload is a real, stored setup, but it is clearly
   * labelled as a test on every channel and is never treated as actionable.
   */
  test?: boolean;
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
    .select("id, email_alerts_enabled, push_alerts_enabled, alert_tiers_email, alert_tiers_push");

  if (error) throw new Error(`Notification recipient lookup failed: ${error.message}`);
  if (!profiles?.length) throw new Error("No notification recipients are configured.");

  // The tier stored on the signal is the only tier ever shown or sent.
  const tier: Tier | null = isTier(alert.grade) ? alert.grade : null;
  const label = tierLabel(alert.grade);
  const test = alert.test === true;
  const title = `${test ? "[TEST] " : ""}${alert.instrument} ${alert.direction} — Tier ${label}`;
  const rrText = alert.rr
    ? `Qualified setup with ${alert.rr.toFixed(2)}R to TP1. You place the trade manually.`
    : "Qualified setup. You place the trade manually.";
  const body = test
    ? `Delivery test on a real armed setup. Do NOT trade this alert. ${rrText}`
    : rrText;

  const rows = profiles.map((p) => ({
    user_id: p.id,
    // Delivery tests must never occupy the real signal's idempotency slot.
    signal_id: test ? null : alert.signalId,
    title,
    body,
  }));
  const { error: insertError } = test
    ? await admin.from("notifications").insert(rows)
    : await admin
        .from("notifications")
        .upsert(rows, { onConflict: "user_id,signal_id", ignoreDuplicates: true });
  if (insertError) throw new Error(`Notification insert failed: ${insertError.message}`);

  // Push
  const pushUsers = profiles
    .filter(
      (p) =>
        p.push_alerts_enabled !== false &&
        tier !== null &&
        parseTiers(p.alert_tiers_push, DEFAULT_PUSH_TIERS).includes(tier),
    )
    .map((p) => p.id);
  const push = await sendPushToUsers(admin, pushUsers, {
    title,
    body,
    url: `${SITE_URL}/signals/${alert.signalId}`,
    // Test alerts must never collapse into the real alert's notification slot.
    tag: test ? `signal-test-${alert.signalId}` : `signal-${alert.signalId}`,
  });

  // Email
  const emailInput: AlertEmailInput = {
    signalId: alert.signalId,
    test,
    tier,
    instrument: alert.instrument,
    direction: alert.direction,
    grade: label,
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
  const emailRecipients = profiles.filter(
    (p) =>
      p.email_alerts_enabled &&
      tier !== null &&
      parseTiers(p.alert_tiers_email, DEFAULT_EMAIL_TIERS).includes(tier),
  );
  for (const profile of emailRecipients) {
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

  const failures: string[] = [];
  if (push.failed > 0) failures.push(`${push.failed} push delivery attempt(s) failed`);
  if (emails < emailRecipients.length) {
    failures.push(`${emailRecipients.length - emails} email delivery attempt(s) failed`);
  }
  if (failures.length > 0) {
    // The in-app row is already idempotently persisted. Throwing here leaves
    // the outbox retryable; email uses a stable idempotency key and browser
    // push uses a stable tag, so a retry does not create duplicate alerts.
    throw new Error(failures.join("; "));
  }

  return { sent: profiles.length, push: push.sent, emails, suppressed: false };
}

/**
 * Channel readiness probe.
 *
 * Silence has two indistinguishable causes: nothing qualified, or something
 * qualified and delivery was structurally impossible (no recipients, every
 * tier switched off, no push subscriptions, no email transport). This reports
 * the second class BEFORE a signal exists, so a dead channel is visible in the
 * heartbeat instead of being discovered by a missing alert.
 *
 * It sends nothing. It only reads configuration.
 */
export type ChannelReadiness = {
  recipients: number;
  terminal: boolean;
  push: { enabled: number; subscriptions: number; ready: boolean };
  email: { enabled: number; transport: boolean; ready: boolean };
  tiersCovered: Tier[];
  problems: string[];
};

export async function verifyNotificationChannels(admin: Admin): Promise<ChannelReadiness> {
  const problems: string[] = [];
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, email_alerts_enabled, push_alerts_enabled, alert_tiers_email, alert_tiers_push");

  if (error) problems.push(`Recipient lookup failed: ${error.message}`);
  const rows = profiles ?? [];
  if (rows.length === 0) problems.push("No profiles exist, so no alert can be delivered.");

  const pushEnabled = rows.filter((p) => p.push_alerts_enabled !== false);
  const emailEnabled = rows.filter((p) => p.email_alerts_enabled);

  const { count: subscriptions } = await admin
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true });
  const subs = subscriptions ?? 0;

  const transport = Boolean(process.env.LOVABLE_API_KEY);
  if (!transport)
    problems.push("Email transport is not configured, so no alert email can be sent.");
  if (pushEnabled.length > 0 && subs === 0) {
    problems.push("Push is enabled but no device subscription is registered.");
  }
  if (pushEnabled.length === 0 && emailEnabled.length === 0 && rows.length > 0) {
    problems.push("Every user has both push and email alerts switched off.");
  }

  const covered = new Set<Tier>();
  for (const p of rows) {
    for (const t of parseTiers(p.alert_tiers_push, DEFAULT_PUSH_TIERS)) covered.add(t);
    for (const t of parseTiers(p.alert_tiers_email, DEFAULT_EMAIL_TIERS)) covered.add(t);
  }
  const tiersCovered = (["A_PLUS", "A", "B", "C"] as Tier[]).filter((t) => covered.has(t));
  const missing = (["A_PLUS", "A", "B", "C"] as Tier[]).filter((t) => !covered.has(t));
  if (missing.length > 0) {
    problems.push(`No recipient subscribes to tier(s): ${missing.map(tierLabel).join(", ")}.`);
  }

  return {
    recipients: rows.length,
    // The in-app row is always written, so the terminal is live whenever a
    // recipient exists at all.
    terminal: rows.length > 0,
    push: {
      enabled: pushEnabled.length,
      subscriptions: subs,
      ready: pushEnabled.length > 0 && subs > 0,
    },
    email: { enabled: emailEnabled.length, transport, ready: emailEnabled.length > 0 && transport },
    tiersCovered,
    problems,
  };
}
