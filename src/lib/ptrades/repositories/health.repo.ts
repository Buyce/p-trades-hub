import { queryOptions } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
import { db, unwrap, unwrapList } from "./client";

/** Repository for system health, scanner runs, instruments and macro events. */

export type Heartbeat = Tables<"system_heartbeats">;
export type ScannerRun = Tables<"scanner_runs">;
export type Instrument = Tables<"instruments">;
export type MacroEvent = Tables<"macro_events">;

export const latestHeartbeatQuery = () =>
  queryOptions({
    queryKey: ["heartbeat", "latest"],
    refetchInterval: 60_000,
    queryFn: () =>
      unwrap(
        db
          .from("system_heartbeats")
          .select("*")
          .order("received_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        { repo: "health.latestHeartbeat" },
      ),
  });

export const heartbeatHistoryQuery = (limit = 30) =>
  queryOptions({
    queryKey: ["heartbeat", "history", limit],
    queryFn: () =>
      unwrapList(
        db
          .from("system_heartbeats")
          .select("*")
          .order("received_at", { ascending: false })
          .limit(limit),
        { repo: "health.heartbeatHistory" },
      ),
  });

export const scannerRunsQuery = (limit = 25) =>
  queryOptions({
    queryKey: ["scanner_runs", limit],
    queryFn: () =>
      unwrapList(
        db.from("scanner_runs").select("*").order("started_at", { ascending: false }).limit(limit),
        { repo: "health.runs" },
      ),
  });

export const instrumentsQuery = () =>
  queryOptions({
    queryKey: ["instruments"],
    queryFn: () =>
      unwrapList(
        db
          .from("instruments")
          .select("*")
          .order("sort_order", { ascending: true })
          .order("symbol", { ascending: true }),
        { repo: "health.instruments" },
      ),
  });

export const macroEventsQuery = () =>
  queryOptions({
    queryKey: ["macro_events"],
    queryFn: () =>
      unwrapList(
        db
          .from("macro_events")
          .select("*")
          .gte("event_time_utc", new Date(Date.now() - 86_400_000).toISOString())
          .order("event_time_utc", { ascending: true }),
        { repo: "health.macroEvents" },
      ),
  });

export type BlockingGate = {
  instrument: string;
  gate: string;
  reason: string;
  count: number;
  total: number;
};

/**
 * "Why nothing alerted today", per instrument: the gate that blocked a setup
 * most often on the current UTC trading day. Reporting only — it summarises
 * stored rejection rows and never re-evaluates a rule.
 */
export const blockingGatesTodayQuery = () =>
  queryOptions({
    queryKey: ["signal_rejections", "today"],
    refetchInterval: 120_000,
    queryFn: async (): Promise<BlockingGate[]> => {
      const rows = await unwrapList(
        db
          .from("signal_rejections")
          .select("instrument, gate_code, reason")
          .eq("trading_day_utc", new Date().toISOString().slice(0, 10))
          .order("created_at", { ascending: false })
          .limit(1000),
        { repo: "health.blockingGatesToday" },
      );

      const byInstrument = new Map<string, { total: number; gates: Map<string, { count: number; reason: string }> }>();
      for (const row of rows) {
        const entry = byInstrument.get(row.instrument) ?? { total: 0, gates: new Map() };
        entry.total += 1;
        const gate = entry.gates.get(row.gate_code) ?? { count: 0, reason: row.reason };
        gate.count += 1;
        entry.gates.set(row.gate_code, gate);
        byInstrument.set(row.instrument, entry);
      }

      return [...byInstrument.entries()]
        .map(([instrument, entry]) => {
          const [gate, detail] = [...entry.gates.entries()].sort((a, b) => b[1].count - a[1].count)[0];
          return { instrument, gate, reason: detail.reason, count: detail.count, total: entry.total };
        })
        .sort((a, b) => b.count - a.count);
    },
  });
