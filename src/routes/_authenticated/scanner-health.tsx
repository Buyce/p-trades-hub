import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getScannerLink } from "@/lib/ptrades/backend.functions";
import {
  heartbeatHistoryQuery,
  scannerRunsQuery,
  activeRulebookQuery,
  blockingGatesTodayQuery,
  lastPurgeQuery,
  RETENTION_WINDOWS,

} from "@/lib/ptrades/queries";
import { useIsStaff, useTimezone } from "@/lib/ptrades/session";
import { tierReachability } from "@/lib/ptrades/scanner/reachability";
import { DEFAULT_RULEBOOK, type Rulebook } from "@/lib/ptrades/scanner/types";
import { tierLabel } from "@/lib/ptrades/tiers";
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
  const linkFn = useServerFn(getScannerLink);

  const { data: link } = useQuery({
    queryKey: ["scanner", "link"],
    queryFn: () => linkFn(),
    refetchInterval: 60_000,
    retry: false,
    enabled: isStaff,
  });
  const { data: heartbeats = [] } = useQuery({ ...heartbeatHistoryQuery(20), enabled: isStaff });
  const { data: runs = [] } = useQuery({ ...scannerRunsQuery(20), enabled: isStaff });
  const { data: rulebook } = useQuery({ ...activeRulebookQuery(), enabled: isStaff });
  const { data: blocking = [] } = useQuery({ ...blockingGatesTodayQuery(), enabled: isStaff });
  const { data: lastPurge } = useQuery({ ...lastPurgeQuery(), enabled: isStaff });


  // Governance diagnostic only: reads the active rulebook's own bands and
  // weights to show whether each tier can ever be produced. It does not score,
  // re-score or re-grade anything.
  const reachability = tierReachability({
    ...DEFAULT_RULEBOOK,
    ...((rulebook?.rules ?? {}) as Partial<Rulebook>),
  } as Rulebook);

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
      <PageHeader
        title="Scanner health"
        subtitle="Cloud scanner, market-data link and run diagnostics."
      />

      <SectionCard
        title="Market data link"
        action={
          <StatusPill state={link?.connected ? "ok" : "warn"}>
            {link?.connected ? "Connected" : link?.configured ? "Degraded" : "Not configured"}
          </StatusPill>
        }
      >
        <DataRow label="Broker server" value={field(link?.server)} />
        <DataRow label="Account login" value={field(link?.login)} />
        <DataRow label="Region" value={field(link?.region)} />
        <DataRow label="Account state" value={field(link?.state)} />
        <DataRow label="Connection" value={field(link?.connectionStatus)} />
        <DataRow label="Reliability" value={field(link?.reliability)} />
        <DataRow label="Active rulebook" value={field(rulebook?.version)} />
        {link?.accountIdMismatch ? (
          <DataRow
            label="Account id"
            value="Configured id did not resolve — using the only deployed account on this token. Update METAAPI_ACCOUNT_ID."
          />
        ) : null}
        {link?.message ? <DataRow label="Last error" value={link.message} /> : null}
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
                <StatusPill state={r.status === "SUCCESS" || r.status === "OK" ? "ok" : "warn"}>
                  {field(r.status)}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Tier reachability">
        <p className="mb-3 text-xs text-muted-foreground">
          A candidate that passes every hard gate already carries a floor score, and the target
          ladder caps the top. Any tier band outside{" "}
          <span className="num">
            {reachability.min}–{reachability.max}
          </span>{" "}
          can never fire.
        </p>
        <ul className="divide-y divide-border/60">
          {reachability.tiers.map((t) => (
            <li key={t.tier} className="py-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="num text-sm font-medium">Tier {tierLabel(t.tier)}</p>
                <StatusPill state={t.reachable ? "ok" : "down"}>
                  {t.reachable ? "Reachable" : "Dead band"}
                </StatusPill>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.note}</p>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Why nothing alerted today">
        {blocking.length === 0 ? (
          <EmptyState
            title="No rejections recorded today"
            description="Either no setup formed yet, or every evaluated setup passed its gates."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {blocking.map((b) => (
              <li key={b.instrument} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="num text-sm font-medium">{b.instrument}</p>
                  <span className="num text-xs text-muted-foreground">
                    {b.count}/{b.total} blocks
                  </span>
                </div>
                <p className="num mt-1 text-xs font-semibold text-primary">{b.gate}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{b.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>

  );
}
