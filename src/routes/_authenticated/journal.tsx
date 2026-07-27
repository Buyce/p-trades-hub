import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  myDecisionsQuery,
  myTradesQuery,
  recentSignalsQuery,
  type Trade,
  createTrade,
  closeTrade,
} from "@/lib/ptrades/queries";
import { userMessageOf } from "@/lib/ptrades/errors";
import { useSessionUser, useTimezone } from "@/lib/ptrades/session";
import { field, formatTime } from "@/lib/ptrades/format";
import {
  DirectionTag,
  EmptyState,
  GradeBadge,
  PageHeader,
  SectionCard,
} from "@/components/ptrades/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/journal")({
  head: () => ({
    meta: [
      { title: "Journal — P-Trades" },
      {
        name: "description",
        content: "Your decision log and trade record for every scanner signal, including B-grades.",
      },
      { property: "og:title", content: "Journal — P-Trades" },
      { property: "og:description", content: "Decision and trade journal for P-Trades." },
    ],
  }),
  component: Journal,
});

function Journal() {
  const tz = useTimezone();
  const { data: decisions = [] } = useQuery(myDecisionsQuery());
  const { data: signals = [] } = useQuery(recentSignalsQuery(200));
  const { data: trades = [] } = useQuery(myTradesQuery());
  const signalById = new Map(signals.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      <PageHeader title="Journal" subtitle="Every decision and trade you recorded." />

      <Tabs defaultValue="decisions">
        <TabsList className="w-full">
          <TabsTrigger value="decisions" className="flex-1">
            Decisions
          </TabsTrigger>
          <TabsTrigger value="trades" className="flex-1">
            Trades
          </TabsTrigger>
        </TabsList>

        <TabsContent value="decisions" className="mt-4">
          <SectionCard>
            {decisions.length === 0 ? (
              <EmptyState
                title="No decisions yet"
                description="Open a signal and record Taken, Skipped, Expired or Invalidated."
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {decisions.map((d) => {
                  const signal = signalById.get(d.signal_id);
                  return (
                    <li key={d.id} className="py-3">
                      <Link
                        to="/signals/$signalId"
                        params={{ signalId: d.signal_id }}
                        className="block"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="num text-sm font-medium">
                              {signal ? signal.instrument : "Signal"}
                            </span>
                            {signal && <DirectionTag direction={signal.direction} />}
                          </div>
                          <span className="num text-xs font-semibold text-primary">
                            {d.decision}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-3">
                          <span className="text-xs text-muted-foreground">
                            {formatTime(d.decided_at, tz)}
                          </span>
                          {signal && <GradeBadge grade={signal.grade} />}
                        </div>
                        {d.note && <p className="mt-2 text-sm text-muted-foreground">{d.note}</p>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="trades" className="mt-4">
          <SectionCard>
            {trades.length === 0 ? (
              <EmptyState
                title="No trades logged"
                description="Log a trade after you execute it in MT5. P-Trades never places orders."
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {trades.map((t) => (
                  <TradeRow key={t.id} trade={t} tz={tz} />
                ))}
              </ul>
            )}
          </SectionCard>
          <div className="mt-4">
            <NewTradeForm />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TradeRow({ trade, tz }: { trade: Trade; tz: string }) {
  const queryClient = useQueryClient();
  const [r, setR] = useState("");
  const close = useMutation({
    mutationFn: async () => {
      await closeTrade({ tradeId: trade.id, rMultiple: Number(r.trim()) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      toast.success("Trade closed");
    },
    onError: (e: unknown) => toast.error(userMessageOf(e)),
  });

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="num text-sm font-medium">{trade.instrument}</span>
          <DirectionTag direction={trade.direction} />
        </div>
        <span className="num text-sm">
          {trade.r_multiple === null ? trade.status : `${Number(trade.r_multiple).toFixed(2)}R`}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Opened {formatTime(trade.opened_at, tz)} · {field(trade.outcome ?? trade.status)}
      </p>
      {trade.status === "OPEN" && (
        <div className="mt-2 flex gap-2">
          <Input
            inputMode="decimal"
            placeholder="Realised R"
            value={r}
            onChange={(e) => setR(e.target.value)}
            className="h-11"
          />
          <Button className="h-11" onClick={() => close.mutate()} disabled={close.isPending}>
            Close
          </Button>
        </div>
      )}
    </li>
  );
}

function NewTradeForm() {
  const queryClient = useQueryClient();
  const { data: user } = useSessionUser();
  const [instrument, setInstrument] = useState("");
  const [direction, setDirection] = useState("LONG");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      await createTrade({
        userId: user?.id,
        instrument,
        direction,
        entryPrice: entry ? Number(entry) : null,
        stopPrice: stop ? Number(stop) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      setInstrument("");
      setEntry("");
      setStop("");
      toast.success("Trade logged");
    },
    onError: (e: unknown) => toast.error(userMessageOf(e)),
  });

  return (
    <SectionCard title="Log an executed trade">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="Instrument (e.g. XAUUSD)"
          value={instrument}
          onChange={(e) => setInstrument(e.target.value)}
          className="h-11"
        />
        <div className="grid grid-cols-2 gap-2">
          {["LONG", "SHORT"].map((d) => (
            <Button
              key={d}
              type="button"
              variant={direction === d ? "default" : "outline"}
              className="h-11"
              onClick={() => setDirection(d)}
            >
              {d}
            </Button>
          ))}
        </div>
        <Input
          inputMode="decimal"
          placeholder="Entry price"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          className="h-11"
        />
        <Input
          inputMode="decimal"
          placeholder="Stop price"
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          className="h-11"
        />
      </div>
      <Button
        className="mt-3 h-12 w-full"
        onClick={() => create.mutate()}
        disabled={create.isPending}
      >
        Add to journal
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Journal only — this records a trade you already executed in MT5.
      </p>
    </SectionCard>
  );
}
