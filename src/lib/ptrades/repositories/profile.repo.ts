import { queryOptions } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
import { db, requireUserId, unwrap, unwrapList } from "./client";
import { fromPostgrest } from "../errors";

/** Repository for the signed-in user's profile and roles. */

export type Profile = Tables<"profiles">;

export const myProfileQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    queryFn: () =>
      unwrap(db.from("profiles").select("*").eq("id", userId!).maybeSingle(), {
        repo: "profile.mine",
      }),
  });

export const myRolesQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["roles", userId],
    enabled: Boolean(userId),
    queryFn: () =>
      unwrapList(db.from("user_roles").select("role").eq("user_id", userId!), {
        repo: "profile.roles",
      }),
  });

export async function updateProfile(input: {
  userId: string | undefined;
  displayName?: string | null;
  timezone?: string;
}): Promise<void> {
  const userId = requireUserId(input.userId);
  const { error } = await db.from("profiles").upsert({
    id: userId,
    display_name: input.displayName ?? null,
    timezone: input.timezone ?? "UTC",
    updated_at: new Date().toISOString(),
  });
  if (error) throw fromPostgrest(error, { repo: "profile.update" });
}

/** Updates alert channel opt-ins without touching other profile fields. */
export async function updateAlertPreferences(input: {
  userId: string | undefined;
  emailAlertsEnabled?: boolean;
  pushAlertsEnabled?: boolean;
}): Promise<void> {
  const userId = requireUserId(input.userId);
  const patch: {
    updated_at: string;
    email_alerts_enabled?: boolean;
    push_alerts_enabled?: boolean;
  } = { updated_at: new Date().toISOString() };
  if (input.emailAlertsEnabled !== undefined)
    patch.email_alerts_enabled = input.emailAlertsEnabled;
  if (input.pushAlertsEnabled !== undefined) patch.push_alerts_enabled = input.pushAlertsEnabled;

  const { error } = await db.from("profiles").update(patch).eq("id", userId);
  if (error) throw fromPostgrest(error, { repo: "profile.updateAlerts" });
}
