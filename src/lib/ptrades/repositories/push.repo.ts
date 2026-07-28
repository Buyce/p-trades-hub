import { queryOptions } from "@tanstack/react-query";
import { db, requireUserId, unwrapList } from "./client";
import { fromPostgrest } from "../errors";

/** Repository for this browser's web-push subscription. */

export const myPushSubscriptionsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["push_subscriptions", userId],
    enabled: Boolean(userId),
    queryFn: () =>
      unwrapList(db.from("push_subscriptions").select("id, endpoint").eq("user_id", userId!), {
        repo: "push.mine",
      }),
  });

export async function savePushSubscription(input: {
  userId: string | undefined;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}): Promise<void> {
  const userId = requireUserId(input.userId);
  const { error } = await db.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: input.userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw fromPostgrest(error, { repo: "push.save" });
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw fromPostgrest(error, { repo: "push.remove" });
}
