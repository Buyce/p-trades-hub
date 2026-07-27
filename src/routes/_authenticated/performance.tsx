import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  closedTrades,
  expectancy,
  myDecisionsQuery,
  myTradesQuery,
  tradesSince,
  winRate,
} from "@/lib/ptrades/queries";
import { EmptyState, PageHeader, SectionCard, StatTile } from "@/components/ptrades/primitives";

export const Route = createFileRoute("/_authenticated/performance")({
  head: () => ({
    meta: [
      { title: "Performance — P-Trades" },
      {
        name: "description",
        content: "Expectancy, win rate and R distribution across your recorded P-Trades journal.",
      },
      { property: "og:title", content: "Performance — P-Trades" },
      { property: "og:description", content: "Journal-derived performance analytics." },
    ],
  }),
  component: Performance,
});

function Performance() {
  const { data: trades = [] } = useQuery(myTradesQuery());
  const { data: decisions = [] } = useQuery(myDecisionsQuery());

  const closed = closedTrades(trades);
  const overall = expectancy(trades);
  const weekly = expectancy(tradesSince(trades, Date.now() - 7 * 86_400_000));
  const wr = winRate(trades);
  const taken = decisions.filter((d) => d.decision === "TAKEN").length;
  const skipped = decisions.filter((d) => d.decision === "SKIPPED").length;

  const chartData = closed
    .slice()
    .reverse()
    .map((t, i) => ({ name: `#${i + 1}`, r: Number(t.r_multiple) }));

  return (
    <div className="space-y-4">
      <PageHeader title="Performance" subtitle="Derived from your journal only." />

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Expectancy"
          value={overall === null ? "—" : `${overall.toFixed(2)}R`}
          hint={`${closed.length} closed trades`}
          tone={overall === null ? "neutral" : overall >= 0 ? "positive" : "negative"}
        />
        <StatTile
          label="Weekly expectancy"
          value={weekly === null ? "—" : `${weekly.toFixed(2)}R`}
          hint="Last 7 days"
          tone={weekly === null ? "neutral" : weekly >= 0 ? "positive" : "negative"}
        />
        <StatTile
          label="Win rate"
          value={wr === null ? "—" : `${Math.round(wr * 100)}%`}
          hint="Closed trades"
        />
        <StatTile label="Taken / skipped" value={`${taken}/${skipped}`} hint="Decisions logged" />
      </div>

      <SectionCard title="R by closed trade">
        {chartData.length === 0 ? (
          <EmptyState
            title="No closed trades yet"
            description="Close a logged trade with its realised R to populate analytics."
          />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="r" radius={[3, 3, 0, 0]} fill="var(--color-chart-1)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Discipline">
        <p className="text-sm text-muted-foreground">
          A no-trade day counts as a successful outcome. Skipped setups that failed your discretion
          checks are wins for process, not misses.
        </p>
      </SectionCard>
    </div>
  );
}
