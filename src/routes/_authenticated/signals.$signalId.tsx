import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { myDecisionsQuery, signalQuery } from "@/lib/ptrades/queries";
import { useSessionUser, useTimezone } from "@/lib/ptrades/session";
import { field, formatTime, num, rr, score } from "@/lib/ptrades/format";
import {
  DataRow,
  DirectionTag,
  EmptyState,
  GradeBadge,
  PageHeader,
  SectionCard,
} from "@/components/ptrades/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const DECISIONS = ["TAKEN", "SKIPPED", "EXPIRED", "INVALIDATED"] as const;
type DecisionValue = (typeof DECISIONS)[number];

export const Route = createFileRoute("/_authenticated/signals/$signalId")({
  head: () => ({
    meta: [
      { title: "Signal detail — P-Trades" },
      {
        name: "description",
        content:
          "Immutable scanner output for a single setup: entry, stop, targets, score components and invalidation.",
      },
      { property: "og:title", content: "Signal detail — P-Trades" },
      { property: "og:description", content: "Read-only setup detail from the P-Trades scanner." },
    ],
  }),
  component: SignalDetail,
});

function jsonList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
  return [];
}

function jsonEntries(value: unknown): [string, unknown][] {
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.entries(value as Record<string, unknown>);
  return [];
}

function SignalDetail() {
  const { signalId } = Route.useParams();
  const navigate = useNavigate();
  const tz = useTimezone();
  const queryClient = useQueryClient();
  const { data: user } = useSessionUser();
  const { data: signal, isPending } = useQuery(signalQuery(signalId));
  const { data: decisions = [] } = useQuery(myDecisionsQuery());
  const existing = decisions.find((d) => d.signal_id === signalId);
  const [note, setNote] = useState("");

  const saveDecision = useMutation({
    mutationFn: async (decision: DecisionValue) => {
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("signal_decisions").upsert(
        {
          user_id: user.id,
          signal_id: signalId,
          decision,
          note: note.trim() || existing?.note || null,
          decided_at: new Date().toISOString(),
        },
        { onConflict: "user_id,signal_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signal_decisions"] });
      toast.success("Decision recorded");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isPending) return <p className="text-sm text-muted-foreground">Loading signal…</p>;
  if (!signal)
    return (
      <EmptyState title="Signal not found" description="This record is not available to you." />
    );

  const targets = jsonList(signal.targets);
  const reasons = jsonList(signal.reasons);
  const rejections = jsonList(signal.rejection_reasons);
  const components = jsonEntries(signal.score_components);
  const macro = jsonEntries(signal.macro_context);

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate({ to: "/dashboard" })}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PageHeader title={signal.instrument} />
          <DirectionTag direction={signal.direction} />
        </div>
        <GradeBadge grade={signal.grade} />
      </div>

      {signal.grade === "B" && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
          B-grade record — journal only. This is not an actionable alert.
        </p>
      )}

      <SectionCard title="Setup">
        <DataRow label="Broker symbol" value={field(signal.broker_symbol)} />
        <DataRow label="Setup type" value={field(signal.setup_type)} />
        <DataRow label="Timeframe" value={field(signal.timeframe)} />
        <DataRow
          label="Entry zone"
          value={
            signal.entry_zone_low !== null || signal.entry_zone_high !== null
              ? `${num(signal.entry_zone_low)} – ${num(signal.entry_zone_high)}`
              : undefined
          }
        />
        <DataRow label="Stop" value={signal.stop_loss !== null ? num(signal.stop_loss) : undefined} />
        <DataRow
          label="Targets"
          value={targets.length ? targets.join("  ·  ") : undefined}
        />
        <DataRow label="TP1 R:R" value={rr(signal.rr_tp1)} />
        <DataRow label="Spread" value={signal.spread !== null ? num(signal.spread) : undefined} />
        <DataRow label="Invalidation" value={field(signal.invalidation)} mono={false} />
      </SectionCard>

      <SectionCard title="Qualification">
        <DataRow label="Score" value={score(signal.score)} />
        <DataRow label="Grade" value={<GradeBadge grade={signal.grade} />} mono={false} />
        <DataRow label="Rulebook version" value={field(signal.rulebook_version)} />
        {components.length > 0 ? (
          components.map(([key, value]) => (
            <DataRow key={key} label={key} value={field(value)} />
          ))
        ) : (
          <DataRow label="Score components" value={undefined} />
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Qualification score is a rulebook conformance measure, not a guaranteed win probability.
        </p>
      </SectionCard>

      <SectionCard title="Reasons">
        {reasons.length ? (
          <ul className="space-y-2 text-sm">
            {reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm italic text-muted-foreground/70">Unavailable</p>
        )}
      </SectionCard>

      {rejections.length > 0 && (
        <SectionCard title="Rejection reasons">
          <ul className="space-y-2 text-sm text-destructive">
            {rejections.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="Macro context">
        {macro.length ? (
          macro.map(([key, value]) => <DataRow key={key} label={key} value={field(value)} />)
        ) : (
          <p className="text-sm italic text-muted-foreground/70">Unavailable</p>
        )}
      </SectionCard>

      <SectionCard title="Timestamps">
        <DataRow label="Signal time" value={formatTime(signal.signal_time_utc, tz)} />
        <DataRow label="Expires" value={formatTime(signal.expires_at_utc, tz)} />
        <DataRow label="Recorded" value={formatTime(signal.created_at, tz)} />
        <DataRow label="Trading day (UTC)" value={field(signal.trading_day_utc)} />
      </SectionCard>

      <SectionCard title="Your decision">
        {existing && (
          <p className="mb-3 text-sm text-muted-foreground">
            Current: <span className="num font-medium text-foreground">{existing.decision}</span> ·{" "}
            {formatTime(existing.decided_at, tz)}
          </p>
        )}
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={existing?.note ?? "Optional note about this decision"}
          className="mb-3 min-h-20"
        />
        <div className="grid grid-cols-2 gap-2">
          {DECISIONS.map((d) => (
            <Button
              key={d}
              variant={existing?.decision === d ? "default" : "outline"}
              className="h-12"
              disabled={saveDecision.isPending}
              onClick={() => saveDecision.mutate(d)}
            >
              {d.charAt(0) + d.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          P-Trades never places orders. Execution stays in MT5, at your discretion.
        </p>
      </SectionCard>
    </div>
  );
}
