import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UserPlus, RefreshCw, Send, Ban } from "lucide-react";
import {
  createInvite,
  listInvites,
  resendInvite,
  revokeInvite,
  syncInviteStatuses,
  type InviteRecord,
} from "@/lib/ptrades/invites.functions";
import { useIsStaff, useTimezone } from "@/lib/ptrades/session";
import { formatTime } from "@/lib/ptrades/format";
import { EmptyState, PageHeader, SectionCard, StatusPill } from "@/components/ptrades/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin-invites")({
  head: () => ({
    meta: [
      { title: "Invites — P-Trades admin" },
      {
        name: "description",
        content: "Create, resend and revoke P-Trades account invites from the admin console.",
      },
      { property: "og:title", content: "Invites — P-Trades admin" },
      { property: "og:description", content: "Manage access to the P-Trades trading cockpit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminInvites,
});

const STATUS_STATE = {
  PENDING: "warn",
  ACCEPTED: "ok",
  REVOKED: "idle",
} as const;

function AdminInvites() {
  const isStaff = useIsStaff();
  const tz = useTimezone();
  const queryClient = useQueryClient();

  const list = useServerFn(listInvites);
  const create = useServerFn(createInvite);
  const resend = useServerFn(resendInvite);
  const revoke = useServerFn(revokeInvite);
  const sync = useServerFn(syncInviteStatuses);

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [role, setRole] = useState<"trader" | "admin" | "owner">("trader");

  const invitesQuery = useQuery({
    queryKey: ["admin", "invites"],
    queryFn: () => list(),
    enabled: isStaff,
    retry: false,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin", "invites"] });
  }

  const createMutation = useMutation({
    mutationFn: () => create({ data: { email, note: note || undefined, role } }),
    onSuccess: () => {
      toast.success("Invite sent.");
      setEmail("");
      setNote("");
      setRole("trader");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => resend({ data: { id } }),
    onSuccess: () => toast.success("Invite resent."),
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => {
      toast.success("Invite revoked.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const syncMutation = useMutation({
    mutationFn: () => sync(),
    onSuccess: (result: { accepted: number }) => {
      toast.success(
        result.accepted > 0
          ? `${result.accepted} invite(s) marked accepted.`
          : "No new acceptances.",
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!isStaff) {
    return (
      <EmptyState
        title="Restricted"
        description="Invite management is available to owner and admin accounts only."
      />
    );
  }

  const invites = (invitesQuery.data ?? []) as InviteRecord[];
  const pending = invites.filter((i) => i.status === "PENDING");

  return (
    <>
      <PageHeader
        title="Invites"
        subtitle="Issue and manage access to the P-Trades cockpit."
      />

      <SectionCard title="Send an invite">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              autoComplete="off"
              placeholder="trader@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger id="invite-role" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trader">Trader</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-note">Note (optional)</Label>
              <Input
                id="invite-note"
                maxLength={280}
                placeholder="Desk context"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-11"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="h-11" disabled={createMutation.isPending}>
              <UserPlus className="h-4 w-4" aria-hidden />
              {createMutation.isPending ? "Sending…" : "Send invite"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Refresh statuses
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Invites"
        hint={`${pending.length} pending · ${invites.length} total`}
      >
        {invitesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading invites…</p>
        ) : invitesQuery.isError ? (
          <p className="text-sm text-destructive">
            {(invitesQuery.error as Error)?.message ?? "Could not load invites."}
          </p>
        ) : invites.length === 0 ? (
          <EmptyState title="No invites yet" description="Send the first invite above." />
        ) : (
          <ul className="divide-y divide-border">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="num truncate text-sm font-medium text-foreground">
                    {invite.email}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {invite.role} · sent {formatTime(invite.createdAt, tz)}
                    {invite.note ? ` · ${invite.note}` : ""}
                  </p>
                </div>
                <StatusPill state={STATUS_STATE[invite.status]}>{invite.status}</StatusPill>
                {invite.status === "PENDING" && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => resendMutation.mutate(invite.id)}
                      disabled={resendMutation.isPending}
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden />
                      Resend
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => revokeMutation.mutate(invite.id)}
                      disabled={revokeMutation.isPending}
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden />
                      Revoke
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
