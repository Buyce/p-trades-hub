import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { activeRulebookQuery, rulebookVersionsQuery } from "@/lib/ptrades/queries";
import { useTimezone } from "@/lib/ptrades/session";
import { field, formatTime } from "@/lib/ptrades/format";
import {
  DataRow,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@/components/ptrades/primitives";

export const Route = createFileRoute("/_authenticated/rulebook")({
  head: () => ({
    meta: [
      { title: "Rulebook — P-Trades" },
      {
        name: "description",
        content:
          "The non-negotiable rules the scanner enforces: alertable tiers, grade bands, reward floors and rejection conditions.",
      },
      { property: "og:title", content: "Rulebook — P-Trades" },
      { property: "og:description", content: "Active and historical P-Trades rulebook versions." },
    ],
  }),
  component: Rulebook,
});

/**
 * Principles only. Every number — grade bands, R:R floors, expiry, tolerances
 * — is read from the active rulebook above, never restated here. A duplicated
 * threshold in the UI is a threshold that will silently go out of date.
 */
const FIXED_RULES: { label: string; detail: string }[] = [
  {
    label: "Alertable tiers",
    detail:
      "A+, A, B and C can all become actionable. Tier changes the score band and the reward floor, never whether a setup may alert.",
  },
  {
    label: "No daily cap",
    detail: "Alerts are not rationed. Every setup that passes every gate is delivered.",
  },
  {
    label: "Reward floor",
    detail: "TP1 must meet the reward-to-risk floor for its tier, as defined in the active rulebook.",
  },
  { label: "Confirmation", detail: "Closed candles only." },
  {
    label: "Execution timing",
    detail:
      "Setup detection and execution timing are separate. A setup is armed on the higher timeframe and only becomes an alert once the micro trigger, its retest and proximity all confirm.",
  },
  {
    label: "Rejections",
    detail:
      "Stale data, wide spreads, high-impact news lockouts, late entries, duplicate setups, invalid stops and missing data.",
  },
  { label: "Deduplication", detail: "The same setup never alerts twice." },
  { label: "Stops", detail: "A stop is never widened." },
  { label: "Execution", detail: "No order placement. Execution is discretionary and manual." },
  { label: "No-trade days", detail: "A no-trade state is a valid, successful outcome." },
  {
    label: "Score meaning",
    detail: "Qualification score measures rulebook conformance, not win probability.",
  },
];

function Rulebook() {
  const tz = useTimezone();
  const { data: active } = useQuery(activeRulebookQuery());
  const { data: versions = [] } = useQuery(rulebookVersionsQuery());

  // The rulebook is a nested JSON document. Rendering a nested object through
  // a scalar formatter printed "[object Object]" and hid whole rule families,
  // so the tree is flattened to dotted leaf paths instead.
  const rules = flattenRules(active?.rules);

  return (
    <div className="space-y-4">
      <PageHeader title="Rulebook" subtitle="Enforced by the scanner, displayed here read-only." />

      <SectionCard
        title="Active version"
        action={
          <StatusPill state={active ? "ok" : "idle"}>
            {active ? field(active.version) : "Unavailable"}
          </StatusPill>
        }
      >
        <DataRow label="Summary" value={field(active?.summary)} mono={false} />
        <DataRow label="Effective from" value={formatTime(active?.effective_from, tz)} />
        {rules.map(([key, value]) => (
          <DataRow key={key} label={key} value={value} />
        ))}
      </SectionCard>

      <SectionCard title="Non-negotiable rules">
        <ul className="space-y-3">
          {FIXED_RULES.map((rule) => (
            <li key={rule.label}>
              <p className="text-sm font-medium">{rule.label}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{rule.detail}</p>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Version history">
        {versions.length === 0 ? (
          <EmptyState title="No rulebook versions recorded" />
        ) : (
          <ul className="divide-y divide-border/60">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="num text-sm">{field(v.version)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(v.effective_from, tz)}
                  </p>
                </div>
                {v.is_active && <StatusPill state="ok">Active</StatusPill>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
