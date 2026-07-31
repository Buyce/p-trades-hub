import { useQuery } from "@tanstack/react-query";
import { instrumentDiagnosticsQuery } from "@/lib/ptrades/queries";
import type { InstrumentDiagnostics, ReasonCode } from "@/lib/ptrades/queries";
import { formatTime, relativeFromNow } from "@/lib/ptrades/format";
import { EmptyState, StatusPill } from "@/components/ptrades/primitives";

/**
 * "Why is there no alert for this instrument, and since when?"
 *
 * Displays the exact reason code the backend recorded, with the timestamp it
 * was last true. Reporting only: every code, wording and time comes from
 * stored scanner rows.
 */

function severityOf(code: string | undefined): "ok" | "warn" | "down" | "idle" {
  if (!code) return "ok";
  if (code.startsWith("MISSING_") || code.startsWith("STALE_")) return "down";
  if (code.includes(":")) return "down";
  if (code.startsWith("AWAITING")) return "idle";
  return "warn";
}

function Reason({ reason, tz }: { reason: ReasonCode; tz: string }) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="num text-xs font-medium">
          {reason.code}
          {reason.count > 1 ? (
            <span className="ml-1.5 text-muted-foreground">×{reason.count}</span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">{reason.reason}</p>
      </div>
      <span className="num shrink-0 text-[11px] text-muted-foreground">
        {reason.at ? formatTime(reason.at, tz) : "—"}
      </span>
    </li>
  );
}

function Row({ row, tz }: { row: InstrumentDiagnostics; tz: string }) {
  const primary = row.primary;
  return (
    <li className="py-3">
      <details>
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="num text-sm font-medium">{row.instrument}</p>
            <p className="text-xs text-muted-foreground">
              {primary ? primary.reason : "No blocking reason recorded — the scanner is watching."}
            </p>
            <p className="num mt-0.5 text-[11px] text-muted-foreground">
              {primary?.at
                ? `since ${formatTime(primary.at, tz)} · ${relativeFromNow(primary.at)}`
                : row.lastEvaluatedAt
                  ? `last evaluated ${formatTime(row.lastEvaluatedAt, tz)}`
                  : "not evaluated yet today"}
            </p>
          </div>
          <StatusPill state={primary ? severityOf(primary.code) : "ok"}>
            {primary?.code ?? "CLEAR"}
          </StatusPill>
        </summary>

        <div className="mt-3 space-y-3 border-l border-border/60 pl-3">
          <div>
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Data feeds</p>
            <ul className="mt-1">
              {row.feeds.map((f) => (
                <li key={f.timeframe} className="flex items-center justify-between gap-3 py-1">
                  <span className="num text-xs">
                    {f.timeframe}
                    <span className={`ml-2 ${f.stale ? "text-destructive" : "text-muted-foreground"}`}>
                      {f.lastBarTime ? `${f.ageSeconds}s old / ${f.limitSeconds}s limit` : "no bars stored"}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[11px] text-muted-foreground">
                    {f.lastBarTime ? `bar ${formatTime(f.lastBarTime, tz)}` : "—"}
                    {f.fetchedAt ? ` · sync ${formatTime(f.fetchedAt, tz)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {row.precision ? (
            <div>
              <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                Execution timing
              </p>
              <p className="num mt-1 text-xs">
                {row.precision.state}
                {row.precision.ageSeconds !== null
                  ? ` · ${Math.round(row.precision.ageSeconds / 60)}m since arming`
                  : ""}
                {row.precision.checkCount !== null ? ` · ${row.precision.checkCount} checks` : ""}
              </p>
              <ul className="mt-1">
                {(
                  [
                    ["Armed", row.precision.armedAt],
                    ["Trigger", row.precision.triggeredAt],
                    ["Entry ready", row.precision.entryReadyAt],
                    ["Resolved", row.precision.resolvedAt],
                    ["Last checked", row.precision.lastCheckedAt],
                  ] as const
                ).map(([label, at]) => (
                  <li key={label} className="flex items-center justify-between gap-3 py-0.5">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="num text-[11px] text-muted-foreground">
                      {at ? formatTime(at, tz) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
              {row.precision.blocking.length > 0 ? (
                <ul className="mt-1">
                  {row.precision.blocking.map((b, i) => (
                    <Reason key={`${b.code}-${i}`} reason={b} tz={tz} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {row.gates.length > 0 ? (
            <div>
              <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                Gate rejections today
              </p>
              <ul className="mt-1">
                {row.gates.slice(0, 6).map((g) => (
                  <Reason key={g.code} reason={g} tz={tz} />
                ))}
              </ul>
            </div>
          ) : null}

          {row.errors.length > 0 ? (
            <div>
              <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                Scanner errors
              </p>
              <ul className="mt-1">
                {row.errors.map((e, i) => (
                  <Reason key={`${e.code}-${i}`} reason={e} tz={tz} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}

export function AvailabilityDiagnostics({ tz }: { tz: string }) {
  const { data = [], isPending } = useQuery(instrumentDiagnosticsQuery());

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Reading scanner diagnostics…</p>;
  }
  if (data.length === 0) {
    return (
      <EmptyState
        title="No instruments configured"
        description="Diagnostics appear once the scanner has instruments to watch."
      />
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {data.map((row) => (
        <Row key={row.instrument} row={row} tz={tz} />
      ))}
    </ul>
  );
}
