/**
 * Email delivery for qualified alerts. Opt-in per user via
 * `profiles.email_alerts_enabled`. Best-effort: failures are logged and never
 * interrupt a scan.
 */

import * as React from "react";
import { render } from "@react-email/render";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { SignalAlertEmail } from "@/lib/email-templates/signal-alert";
import { tierSubject } from "@/lib/email-templates/tier-alert-copy";
import type { Tier } from "@/lib/ptrades/tiers";

const SITE_NAME = "P-Trades";
const FROM_DOMAIN = "notify.getptrades.com";
const SITE_URL = "https://getptrades.com";

export type AlertEmailInput = {
  signalId: string;
  /** Delivery test — labelled in the subject and body, never actionable. */
  test?: boolean;
  /** Stored tier code — drives the subject line and the body copy. */
  tier: Tier | null;
  instrument: string;
  direction: string;
  grade: string;
  setupType: string;
  timeframe: string;
  entryZone: string;
  stopLoss: string;
  targets: string[];
  rrTp1: string;
  score: string;
  reasons: string[];
};

export async function sendAlertEmail(
  recipient: string,
  input: AlertEmailInput,
): Promise<boolean> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return false;

  const element = React.createElement(SignalAlertEmail, {
    siteName: SITE_NAME,
    signalUrl: `${SITE_URL}/signals/${input.signalId}`,
    ...input,
  });

  try {
    const html = await render(element);
    const text = await render(element, { plainText: true });

    await sendLovableEmail(
      {
        to: recipient,
        from: `${SITE_NAME} <alerts@${FROM_DOMAIN}>`,
        sender_domain: FROM_DOMAIN,
        subject: `${input.test ? "[TEST] " : ""}${tierSubject(input.tier, input)}`,
        html,
        text,
        // App (transactional) sends must use purpose=transactional together
        // with an idempotency_key; anything else is rejected as an auth send.
        purpose: "transactional",
        idempotency_key: input.test
          ? `signal-test-${input.signalId}-${recipient}`
          : input.tier
            ? `signal-${input.tier.toLowerCase()}-${input.signalId}-${recipient}`
            : `signal-${input.signalId}-${recipient}`,
      },
      { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
    );
    return true;
  } catch (error) {
    console.error("alert email failed", error instanceof Error ? error.message : "unknown");
    return false;
  }
}
