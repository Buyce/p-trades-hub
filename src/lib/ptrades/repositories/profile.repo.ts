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
