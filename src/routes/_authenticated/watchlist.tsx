import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { instrumentsQuery, signalsTodayQuery } from "@/lib/ptrades/queries";
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

/**
 * Plain-language description of where a signal sits in its lifecycle, so a
 * watchlist row explains what the terminal is doing instead of showing a bare
 * state code or an empty value.
 */
function lifecycleCopy(state: string | null): string {
  switch (state) {
    case "DETECTED":
      return "Setup detected, checking execution timing";
    case "ARMED":
      return "Armed, waiting for the entry trigger";
    case "MICRO_TRIGGERED":
      return "Trigger fired, confirming the entry";
    case "ENTRY_READY":
      return "Entry ready";
    case "MISSED":
      return "Price left the entry before it confirmed";
    case "INVALIDATED":
      return "Invalidated";
    case "EXPIRED":
      return "Expired before entry";
    default:
      return "Recorded";
  }
}

function Watchlist() {
  const tz = useTimezone();
  const { data: instruments = [], isPending } = useQuery(instrumentsQuery());
  const { data: signals = [] } = useQuery(signalsTodayQuery());

  const symbols = instruments.length
    ? {
        enabled: instruments.filter((i) => i.enabled).map((i) => i.symbol),
        disabled: instruments.filter((i) => !i.enabled).map((i) => i.symbol),
      }
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Watchlist"
        subtitle="Instruments the cloud scanner is configured to monitor."
      />

      <SectionCard
        title="Configuration source"
        action={
          <StatusPill state={symbols ? "ok" : isPending ? "idle" : "warn"}>
            {symbols ? "Loaded" : isPending ? "Checking" : "Unavailable"}
          </StatusPill>
        }
      >
        <p className="text-sm text-muted-foreground">
          Instrument coverage is read from the scanner configuration stored in the database. The
          frontend does not add, infer or reorder instruments.
        </p>
      </SectionCard>

      <SectionCard title="Monitored instruments">
        {!symbols ? (
          <EmptyState
            title="Unavailable"
            description="No instruments are configured for the scanner yet. Nothing is inferred here."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {[
              ...symbols.enabled.map((s) => ({ symbol: s, enabled: true })),
              ...symbols.disabled.map((s) => ({ symbol: s, enabled: false })),
            ].map(({ symbol, enabled }) => {
              const todays = signals.filter((s) => s.instrument === symbol);
              const best = todays[0];
              // A signal that has not reached ENTRY_READY has no final grade
              // yet. That is the scanner still working, not missing data, so
              // it shows the tier the current score would earn, marked
              // provisional — never the blank "Unavailable" chip.
              const tier = best ? (best.final_grade ?? best.grade ?? best.provisional_grade) : null;
              const provisional = Boolean(best && !best.final_grade && !best.grade && tier);
              const shownScore = best ? (best.final_score ?? best.score ?? best.provisional_score) : null;
              const state = best?.lifecycle_state ?? null;
              return (
                <li key={symbol} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="num text-sm font-medium">{symbol}</p>
                    <p className="text-xs text-muted-foreground">
                      {!enabled
                        ? "Disabled pending calibration"
                        : best
                          ? `${lifecycleCopy(state)} · ${formatTime(best.signal_time_utc, tz)}`
                          : "No setup has formed today. The scanner is still watching."}
                    </p>
                  </div>
                  {best ? (
                    <Link
                      to="/signals/$signalId"
                      params={{ signalId: best.id }}
                      className="flex items-center gap-2"
                    >
                      <span className="num text-xs text-muted-foreground">{score(shownScore)}</span>
                      {tier ? (
                        <GradeBadge grade={tier} signalId={best.id} surface="watchlist" />
                      ) : (
                        <StatusPill state="idle">Scoring</StatusPill>
                      )}
                      {provisional ? (
                        <span
                          className="text-[10px] tracking-wide text-muted-foreground uppercase"
                          title="The tier this score would earn. It is confirmed when the setup becomes entry ready."
                        >
                          Prov.
                        </span>
                      ) : null}
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
