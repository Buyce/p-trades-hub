/**
 * Email delivery for qualified alerts. Opt-in per user via
 * `profiles.email_alerts_enabled`. Best-effort: failures are logged and never
 * interrupt a scan.
 */

import * as React from "react";
import { render } from "@react-email/render";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { SignalAlertEmail } from "@/lib/email-templates/signal-alert";

const SITE_NAME = "P-Trades";
const FROM_DOMAIN = "notify.beinvestlabs.com";
const SITE_URL = "https://p-trade-spotlight.lovable.app";

export type AlertEmailInput = {
  signalId: string;
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
        subject: `${input.instrument} ${input.direction} — ${input.grade} setup (${input.rrTp1} to TP1)`,
        html,
        text,
        purpose: "signal-alert",
        idempotency_key: `signal-${input.signalId}-${recipient}`,
      },
      { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
    );
    return true;
  } catch (error) {
    console.error("alert email failed", error instanceof Error ? error.message : "unknown");
    return false;
  }
}
