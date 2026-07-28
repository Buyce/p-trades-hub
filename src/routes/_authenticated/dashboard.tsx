import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import {
  activeRulebookQuery,
  latestHeartbeatQuery,
  myTradesQuery,
  signalsTodayQuery,
  expectancy,
  tradesSince,
  MAX_DAILY_ALERTS,
} from "@/lib/ptrades/queries";
import { getScannerLink } from "@/lib/ptrades/backend.functions";
import { useProfile, useSessionUser, useTimezone } from "@/lib/ptrades/session";
import { updateAlertPreferences } from "@/lib/ptrades/queries";
import { TierToggle } from "@/components/ptrades/tier-toggle";
import { DEFAULT_TERMINAL_TIERS, parseTiers, isTier, type Tier } from "@/lib/ptrades/tiers";
import { field, formatTime, relativeFromNow, rr, score } from "@/lib/ptrades/format";
import {
  DataRow,
  DirectionTag,
  EmptyState,
  GradeBadge,
  PageHeader,
  SectionCard,
  StatTile,
  StatusPill,
} from "@/components/ptrades/primitives";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — P-Trades" },
      {
        name: "description",
        content:
          "Live scanner status, today's actionable A/A+ alerts, open trades and weekly expectancy.",
      },
      { property: "og:title", content: "Dashboard — P-Trades" },
      {
        property: "og:description",
        content: "Read-only discretionary trading cockpit for the P-Trades scanner.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const tz = useTimezone();
  const { data: signals = [] } = useQuery(signalsTodayQuery());
  const { data: heartbeat } = useQuery(latestHeartbeatQuery());
  const { data: rulebook } = useQuery(activeRulebookQuery());
  const { data: trades = [] } = useQuery(myTradesQuery());

  const linkFn = useServerFn(getScannerLink);
  const { data: link } = useQuery({
    queryKey: ["scanner", "link"],
    queryFn: () => linkFn(),
    refetchInterval: 120_000,
    retry: false,
  });

  const { data: user } = useSessionUser();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();
  const terminalTiers = parseTiers(profile?.alert_tiers_terminal, DEFAULT_TERMINAL_TIERS);
  const saveTiers = useMutation({
    mutationFn: (next: Tier[]) =>
      updateAlertPreferences({ userId: user?.id, terminalTiers: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });

  // Terminal filtering is display-only: it hides rows, it never re-tiers them.
  const visibleSignals = signals.filter(
    (s) => isTier(s.grade) && terminalTiers.includes(s.grade),
  );

  const actionable = signals.filter((s) => s.is_actionable);
  const alertsToday = actionable.length;
  const latestQualified = signals.find((s) => s.grade === "A_PLUS" || s.grade === "A") ?? null;
  const openTrades = trades.filter((t) => t.status === "OPEN");
  const weekly = expectancy(tradesSince(trades, Date.now() - 7 * 86_400_000));

  const heartbeatAgeMin = heartbeat
    ? (Date.now() - new Date(heartbeat.received_at).getTime()) / 60_000
    : null;
  const linkState =
    heartbeatAgeMin === null ? "idle" : heartbeatAgeMin < 10 ? "ok" : heartbeatAgeMin < 60 ? "warn" : "down";

  // The scanner records the broker server on every heartbeat, so the feed name
  // is available even when the direct MetaApi account lookup is unavailable.
  const heartbeatServer =
    (heartbeat?.detail as { account?: { server?: string | null } } | null | undefined)?.account
      ?.server ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle={`Trading day ${new Date().toISOString().slice(0, 10)} UTC`}
      />

      <SectionCard
        title="Market data link"
        action={
          <StatusPill state={linkState}>
            {heartbeat ? `Heartbeat ${relativeFromNow(heartbeat.received_at)}` : "No heartbeat"}
          </StatusPill>
        }
      >
        <DataRow
          label="Scanner status"
          value={heartbeat ? field(heartbeat.status) : undefined}
        />
        <DataRow
          label="MT5 connection"
          value={
            link?.configured
              ? link.connected
                ? "Connected"
                : field(link.connectionStatus ?? link.state ?? link.message)
              : heartbeat?.mt5_connected === null || heartbeat?.mt5_connected === undefined
                ? undefined
                : heartbeat.mt5_connected
                  ? "Connected"
                  : "Disconnected"
          }
        />
        <DataRow label="Broker feed" value={field(link?.server ?? heartbeatServer)} />
        <DataRow
          label="Last heartbeat"
          value={heartbeat ? formatTime(heartbeat.received_at, tz) : undefined}
        />
        <DataRow
          label="Active rulebook"
          value={rulebook ? field(rulebook.version) : field(heartbeat?.rulebook_version)}
        />
      </SectionCard>

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Alerts today"
          value={alertsToday}
          hint="All tiers · no daily cap"

          tone={alertsToday > 0 ? "accent" : "neutral"}
        />
        <StatTile label="Open trades" value={openTrades.length} hint="Your journal" />
        <StatTile
          label="Weekly expectancy"
          value={weekly === null ? "—" : `${weekly.toFixed(2)}R`}
          hint="Closed trades, last 7 days"
          tone={weekly === null ? "neutral" : weekly >= 0 ? "positive" : "negative"}
        />
        <StatTile label="Signals scanned today" value={signals.length} hint="All grades" />
      </div>

      {actionable.length === 0 && (
        <SectionCard title="Today's state">
          <div className="rounded-md border border-border bg-surface px-4 py-6 text-center">
            <p className="text-sm font-semibold text-foreground">No qualified setup right now</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              A no-trade day is a valid, successful outcome. The scanner alerts whenever a setup
              meets every rulebook condition for its tier — there is no daily alert limit.

            </p>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Latest A / A+ signal">
        {latestQualified ? (
          <Link
            to="/signals/$signalId"
            params={{ signalId: latestQualified.id }}
            className="block rounded-md border border-border bg-surface p-4 transition-colors hover:border-primary/50"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="num text-base font-semibold">{latestQualified.instrument}</span>
                <DirectionTag direction={latestQualified.direction} />
              </div>
              <GradeBadge grade={latestQualified.grade} signalId={latestQualified.id} surface="dashboard-latest" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Score</p>
                <p className="num">{score(latestQualified.score)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">TP1 R:R</p>
                <p className="num">{rr(latestQualified.rr_tp1)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Time</p>
                <p className="num">
                  {formatTime(latestQualified.signal_time_utc, tz, {
                    year: undefined,
                    month: undefined,
                    day: undefined,
                  })}
                </p>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">
              Open signal detail <ArrowRight className="h-3 w-3" />
            </p>
          </Link>
        ) : (
          <EmptyState
            title="No A or A+ signal today"
            description="B-grade records are journal-only and never become alerts."
          />
        )}
      </SectionCard>

      <SectionCard title="Today's records">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">Tiers shown</span>
          <TierToggle
            idPrefix="terminal-tier"
            size="sm"
            value={terminalTiers}
            disabled={saveTiers.isPending}
            onChange={(next) => saveTiers.mutate(next)}
          />
        </div>
        {visibleSignals.length === 0 ? (
          <EmptyState
            title={signals.length === 0 ? "Nothing recorded yet" : "No signals in the selected tiers"}
            description={
              signals.length === 0
                ? "Signals appear here once the scanner reports a run for this UTC day."
                : "Turn a tier back on above to see the rest of today's records."
            }
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {visibleSignals.map((s) => (
              <li key={s.id}>
                <Link
                  to="/signals/$signalId"
                  params={{ signalId: s.id }}
                  className="flex min-h-[56px] items-center justify-between gap-3 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="num text-sm font-medium">{s.instrument}</span>
                    <DirectionTag direction={s.direction} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="num text-xs text-muted-foreground">{score(s.score)}</span>
                    <GradeBadge grade={s.grade} signalId={s.id} surface="dashboard-terminal" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
