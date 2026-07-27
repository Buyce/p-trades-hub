import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBackendConfiguration } from "@/lib/ptrades/backend.functions";
import { signalsTodayQuery } from "@/lib/ptrades/queries";
import { useTimezone } from "@/lib/ptrades/session";
import { formatTime, score } from "@/lib/ptrades/format";
import {
  EmptyState,
  GradeBadge,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@/components/ptrades/primitives";

export const Route = createFileRoute("/_authenticated/watchlist")({
  head: () => ({
    meta: [
      { title: "Watchlist — P-Trades" },
      {
        name: "description",
        content: "Instruments the scanner is currently monitoring and their state for today.",
      },
      { property: "og:title", content: "Watchlist — P-Trades" },
      { property: "og:description", content: "Scanner watchlist and per-instrument status." },
    ],
  }),
  component: Watchlist,
});

function readSymbols(payload: unknown): { enabled: string[]; disabled: string[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const raw = record.symbols ?? record.instruments ?? record.enabled_symbols;
  if (Array.isArray(raw)) {
    return { enabled: raw.map(String), disabled: [] };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const enabled = Array.isArray(obj.enabled) ? obj.enabled.map(String) : [];
    const disabled = Array.isArray(obj.disabled) ? obj.disabled.map(String) : [];
    if (enabled.length || disabled.length) return { enabled, disabled };
  }
  return null;
}

function Watchlist() {
  const tz = useTimezone();
  const configFn = useServerFn(getBackendConfiguration);
  const { data: config, isPending } = useQuery({
    queryKey: ["backend", "configuration"],
    queryFn: () => configFn(),
    retry: false,
  });
  const { data: signals = [] } = useQuery(signalsTodayQuery());

  const symbols = config?.ok ? readSymbols(config.data) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Watchlist"
        subtitle="Instrument coverage reported by the scanner configuration."
      />

      <SectionCard
        title="Configuration source"
        action={
          <StatusPill state={config?.ok ? "ok" : isPending ? "idle" : "warn"}>
            {config?.ok ? "Backend reachable" : isPending ? "Checking" : "Unavailable"}
          </StatusPill>
        }
      >
        {config?.ok ? (
          <p className="text-sm text-muted-foreground">
            Live configuration read from the Python scanner.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {config && !config.ok
              ? config.message
              : "Waiting for the scanner configuration endpoint."}
          </p>
        )}
      </SectionCard>

      <SectionCard title="Monitored instruments">
        {!symbols ? (
          <EmptyState
            title="Unavailable"
            description="The scanner configuration did not return an instrument list. Nothing is inferred here."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {[
              ...symbols.enabled.map((s) => ({ symbol: s, enabled: true })),
              ...symbols.disabled.map((s) => ({ symbol: s, enabled: false })),
            ].map(({ symbol, enabled }) => {
              const todays = signals.filter((s) => s.instrument === symbol);
              const best = todays[0];
              return (
                <li key={symbol} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="num text-sm font-medium">{symbol}</p>
                    <p className="text-xs text-muted-foreground">
                      {enabled
                        ? best
                          ? `Last record ${formatTime(best.signal_time_utc, tz)}`
                          : "No record today"
                        : "Disabled pending calibration"}
                    </p>
                  </div>
                  {best ? (
                    <Link
                      to="/signals/$signalId"
                      params={{ signalId: best.id }}
                      className="flex items-center gap-2"
                    >
                      <span className="num text-xs text-muted-foreground">{score(best.score)}</span>
                      <GradeBadge grade={best.grade} />
                    </Link>
                  ) : (
                    <StatusPill state={enabled ? "idle" : "warn"}>
                      {enabled ? "Watching" : "Disabled"}
                    </StatusPill>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
