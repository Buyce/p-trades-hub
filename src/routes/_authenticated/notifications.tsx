import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import {
  markAllNotificationsRead,
  markNotificationRead,
  myNotificationsQuery,
  unreadCount,
} from "@/lib/ptrades/queries";
import { useSessionUser, useTimezone } from "@/lib/ptrades/session";
import { formatTime, relativeFromNow } from "@/lib/ptrades/format";
import { EmptyState, PageHeader, SectionCard } from "@/components/ptrades/primitives";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Alerts — P-Trades" },
      {
        name: "description",
        content:
          "Every actionable A/A+ alert the P-Trades scanner has issued, with read state and links to the signal detail.",
      },
      { property: "og:title", content: "Alerts — P-Trades" },
      {
        property: "og:description",
        content: "Alert history for the P-Trades discretionary trading cockpit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Notifications,
});

function Notifications() {
  const tz = useTimezone();
  const queryClient = useQueryClient();
  const { data: user } = useSessionUser();
  const { data: notifications = [] } = useQuery(myNotificationsQuery(user?.id));
  const unread = unreadCount(notifications);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const readOne = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: invalidate,
  });
  const readAll = useMutation({
    mutationFn: () => markAllNotificationsRead(user?.id),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Alerts"
        subtitle={unread > 0 ? `${unread} unread` : "All caught up"}
      />

      <SectionCard
        title="Alert history"
        action={
          unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => readAll.mutate()}
              disabled={readAll.isPending}
            >
              <CheckCheck className="mr-1 h-4 w-4" aria-hidden />
              Mark all read
            </Button>
          ) : undefined
        }
      >
        {notifications.length === 0 ? (
          <EmptyState
            title="No alerts yet"
            description="An alert is issued only when an A or A+ setup passes every rulebook gate, up to the daily cap."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {notifications.map((n) => (
              <li key={n.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num flex items-center gap-2 text-sm font-medium">
                      {n.read_at === null && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                          aria-label="Unread"
                        />
                      )}
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatTime(n.created_at, tz)} · {relativeFromNow(n.created_at)}
                    </p>
                    {n.signal_id && (
                      <Link
                        to="/signals/$signalId"
                        params={{ signalId: n.signal_id }}
                        className="mt-2 inline-block text-xs font-medium text-primary"
                        onClick={() => n.read_at === null && readOne.mutate(n.id)}
                      >
                        Open signal detail
                      </Link>
                    )}
                  </div>
                  {n.read_at === null && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => readOne.mutate(n.id)}
                      disabled={readOne.isPending}
                    >
                      Read
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
