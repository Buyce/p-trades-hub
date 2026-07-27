import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getScannerLink } from "@/lib/ptrades/backend.functions";
import {
  heartbeatHistoryQuery,
  scannerRunsQuery,
  activeRulebookQuery,
} from "@/lib/ptrades/queries";
import { useIsStaff, useTimezone } from "@/lib/ptrades/session";
import { field, formatTime, relativeFromNow } from "@/lib/ptrades/format";
import {
  DataRow,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@/components/ptrades/primitives";

export const Route = createFileRoute("/_authenticated/scanner-health")({
  head: () => ({
    meta: [
      { title: "Scanner health — P-Trades" },
      {
        name: "description",
        content: "Heartbeats, MT5 link state and recent scanner runs for the P-Trades backend.",
      },
      { property: "og:title", content: "Scanner health — P-Trades" },
      { property: "og:description", content: "Backend and MT5 diagnostics." },
    ],
  }),
  component: ScannerHealth,
});

function ScannerHealth() {
  const tz = useTimezone();
  const isStaff = useIsStaff();
  const healthFn = useServerFn(getBackendHealth);
  const mt5Fn = useServerFn(getMt5Status);

  const { data: health } = useQuery({
    queryKey: ["backend", "health"],
    queryFn: () => healthFn(),
    refetchInterval: 60_000,
    retry: false,
    enabled: isStaff,
  });
  const { data: mt5 } = useQuery({
    queryKey: ["backend", "mt5"],
    queryFn: () => mt5Fn(),
    refetchInterval: 60_000,
    retry: false,
    enabled: isStaff,
  });
  const { data: heartbeats = [] } = useQuery({ ...heartbeatHistoryQuery(20), enabled: isStaff });
  const { data: runs = [] } = useQuery({ ...scannerRunsQuery(20), enabled: isStaff });
  const { data: rulebook } = useQuery({ ...activeRulebookQuery(), enabled: isStaff });

  if (!isStaff) {
    return (
      <EmptyState
        title="Restricted"
        description="Scanner health is available to owner and admin accounts only."
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Scanner health" subtitle="Backend, MT5 and ingestion diagnostics." />

      <SectionCard
        title="Backend link"
        action={
          <StatusPill state={health?.ok ? "ok" : "warn"}>
            {health?.ok ? "Reachable" : "Unavailable"}
          </StatusPill>
        }
      >
        <DataRow
          label="Health endpoint"
          value={health?.ok ? "200 OK" : (health?.message ?? undefined)}
        />
        <DataRow
          label="MT5 status"
          value={mt5?.ok ? JSON.stringify(mt5.data) : (mt5?.message ?? undefined)}
        />
        <DataRow label="Active rulebook" value={field(rulebook?.version)} />
      </SectionCard>

      <SectionCard title="Heartbeats">
        {heartbeats.length === 0 ? (
          <EmptyState title="No heartbeats received" />
        ) : (
          <ul className="divide-y divide-border/60">
            {heartbeats.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="num text-sm">{field(h.source)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(h.received_at, tz)} · {relativeFromNow(h.received_at)}
                  </p>
                </div>
                <StatusPill state={h.status === "OK" ? "ok" : "warn"}>
                  {field(h.status)}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Recent scanner runs">
        {runs.length === 0 ? (
          <EmptyState title="No runs recorded" />
        ) : (
          <ul className="divide-y divide-border/60">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="num text-sm">{formatTime(r.started_at, tz)}</p>
                  <p className="text-xs text-muted-foreground">
                    {field(r.symbols_scanned)} scanned · {field(r.signals_emitted)} emitted
                  </p>
                </div>
                <StatusPill state={r.status === "SUCCESS" ? "ok" : "warn"}>
                  {field(r.status)}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
