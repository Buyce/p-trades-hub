/**
 * Web push delivery. Uses WebCrypto only, so it runs in the worker runtime.
 * Sending is isolated from the scanner by the durable outbox. A failing device
 * never blocks market analysis, but retryable failures are reported to the
 * delivery worker. Dead endpoints (404/410) are pruned.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
};

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export async function sendPushToUsers(
  admin: Admin,
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; pruned: number; failed: number }> {
  if (!pushConfigured() || userIds.length === 0) return { sent: 0, pruned: 0, failed: 0 };

  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (error) {
    throw new Error(`Push subscription lookup failed: ${error.message}`);
  }
  if (!subs?.length) {
    return { sent: 0, pruned: 0, failed: 0 };
  }

  const { ApplicationServerKeys, generatePushHTTPRequest } = await import("webpush-webcrypto");
  const keys = await ApplicationServerKeys.fromJSON({
    publicKey: process.env.VAPID_PUBLIC_KEY!,
    privateKey: process.env.VAPID_PRIVATE_KEY!,
  });
  const contact = (process.env.VAPID_SUBJECT ?? "mailto:noreply@localhost").replace(/^mailto:/, "");

  let sent = 0;
  let failed = 0;
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        const request = await generatePushHTTPRequest({
          applicationServerKeys: keys,
          payload: JSON.stringify(payload),
          target: {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          adminContact: contact,
          ttl: 900,
          urgency: "high",
        });

        const response = await fetch(request.endpoint, {
          method: "POST",
          headers: request.headers,
          body: request.body,
        });

        if (response.status === 404 || response.status === 410) {
          dead.push(sub.id);
          return;
        }
        if (!response.ok) {
          console.error("push send failed", response.status);
          failed += 1;
          return;
        }
        sent += 1;
      } catch (pushError) {
        failed += 1;
        console.error(
          "push send threw",
          pushError instanceof Error ? pushError.message : "unknown",
        );
      }
    }),
  );

  if (dead.length) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }

  return { sent, pruned: dead.length, failed };
}
