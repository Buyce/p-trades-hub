import { queryOptions } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
import { db, requireUserId, unwrapList } from "./client";
import { fromPostgrest } from "../errors";

/**
 * Repository for the in-app notification centre. Notifications are written by
 * the scanner (service role) only; the browser can read, mark read and delete.
 */

export type Notification = Tables<"notifications">;

export const myNotificationsQuery = (userId: string | undefined, limit = 50) =>
  queryOptions({
    queryKey: ["notifications", userId, limit],
    enabled: Boolean(userId),
    refetchInterval: 60_000,
    queryFn: () =>
      unwrapList(
        db
          .from("notifications")
          .select("*")
          .eq("user_id", userId!)
          .order("created_at", { ascending: false })
          .limit(limit),
        { repo: "notifications.mine" },
      ),
  });

export function unreadCount(notifications: Notification[]): number {
  return notifications.filter((n) => n.read_at === null).length;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw fromPostgrest(error, { repo: "notifications.markRead" });
}

export async function markAllNotificationsRead(userId: string | undefined): Promise<void> {
  const id = requireUserId(userId);
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", id)
    .is("read_at", null);
  if (error) throw fromPostgrest(error, { repo: "notifications.markAllRead" });
}
