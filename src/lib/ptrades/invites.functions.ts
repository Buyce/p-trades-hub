/**
 * Admin invite management.
 *
 * Thin wrapper module: server-function declarations only. Every function
 * verifies the caller holds an owner/admin role through the authenticated
 * client (RLS applies) before touching privileged Auth Admin APIs.
 *
 * No trading capability is exposed here.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InviteRole = "owner" | "admin" | "trader";
export type InviteStatus = "PENDING" | "ACCEPTED" | "REVOKED";

export type InviteRecord = {
  id: string;
  email: string;
  note: string | null;
  role: InviteRole;
  status: InviteStatus;
  invitedUserId: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type StaffContext = {
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  };
};

async function assertStaff(context: { supabase: unknown; userId: string }) {
  const supabase = (context as unknown as StaffContext).supabase;
  const { data, error } = await supabase.rpc("is_staff", { _user_id: context.userId });
  if (error || data !== true) {
    throw new Error("Forbidden: owner or admin role required.");
  }
}

function mapRow(row: Record<string, unknown>): InviteRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    note: (row.note as string | null) ?? null,
    role: (row.role as InviteRole) ?? "trader",
    status: (row.status as InviteStatus) ?? "PENDING",
    invitedUserId: (row.invited_user_id as string | null) ?? null,
    acceptedAt: (row.accepted_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export const listInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InviteRecord[]> => {
    await assertStaff(context as never);
    const { data, error } = await (context as never as { supabase: any }).supabase
      .from("invites")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRow);
  });

export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(320),
        note: z.string().trim().max(280).optional(),
        role: z.enum(["owner", "admin", "trader"]).default("trader"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<InviteRecord> => {
    await assertStaff(context as never);
    const ctx = context as never as { supabase: any; userId: string };
    const email = data.email.toLowerCase();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
    );
    if (inviteError) throw new Error(inviteError.message);

    const invitedUserId = invited?.user?.id ?? null;

    if (invitedUserId && data.role !== "trader") {
      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: invitedUserId, role: data.role });
      if (roleError && !roleError.message.includes("duplicate")) {
        throw new Error(roleError.message);
      }
    }

    const { data: row, error } = await ctx.supabase
      .from("invites")
      .insert({
        email,
        note: data.note ?? null,
        role: data.role,
        status: "PENDING",
        invited_by: ctx.userId,
        invited_user_id: invitedUserId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(row);
  });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertStaff(context as never);
    const ctx = context as never as { supabase: any };
    const { data: row, error } = await ctx.supabase
      .from("invites")
      .select("email, status")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    if (row.status !== "PENDING") throw new Error("Only pending invites can be resent.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: sendError } = await supabaseAdmin.auth.admin.inviteUserByEmail(row.email);
    if (sendError) throw new Error(sendError.message);
    return { ok: true };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<InviteRecord> => {
    await assertStaff(context as never);
    const ctx = context as never as { supabase: any };
    const { data: row, error } = await ctx.supabase
      .from("invites")
      .update({ status: "REVOKED", revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "PENDING")
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(row);
  });

/** Refreshes PENDING invites whose user has since confirmed their email. */
export const syncInviteStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ accepted: number }> => {
    await assertStaff(context as never);
    const ctx = context as never as { supabase: any };
    const { data: pending, error } = await ctx.supabase
      .from("invites")
      .select("id, invited_user_id")
      .eq("status", "PENDING")
      .not("invited_user_id", "is", null);
    if (error) throw new Error(error.message);
    if (!pending?.length) return { accepted: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let accepted = 0;
    for (const invite of pending as Array<{ id: string; invited_user_id: string }>) {
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(invite.invited_user_id);
      const confirmed = user?.user?.email_confirmed_at ?? user?.user?.last_sign_in_at ?? null;
      if (!confirmed) continue;
      await ctx.supabase
        .from("invites")
        .update({ status: "ACCEPTED", accepted_at: confirmed })
        .eq("id", invite.id);
      accepted += 1;
    }
    return { accepted };
  });
