import { queryOptions } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
import { HEARTBEAT_SOURCES } from "@/lib/ptrades/heartbeat-health";
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
    refetchInterval: 60_000,
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

/**
 * The newest heartbeat for each scheduled component. Detection and execution
 * run on separate schedules, so one can die while the other keeps reporting —
 * a single combined heartbeat hides exactly that failure.
 */
export const componentHeartbeatsQuery = () =>
  queryOptions({
    queryKey: ["heartbeat", "components"],
    refetchInterval: 30_000,
    queryFn: async (): Promise<Record<string, Heartbeat>> => {
      const rows = await unwrapList(
        db
          .from("system_heartbeats")
          .select("*")
          .in("source", [...HEARTBEAT_SOURCES])
          .order("received_at", { ascending: false })
          .limit(50),
        { repo: "health.componentHeartbeats" },
      );
      const latest: Record<string, Heartbeat> = {};
      for (const row of rows) if (!latest[row.source]) latest[row.source] = row;
      return latest;
    },
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

export type InstrumentCoverage = {
  instrument: string;
  scannedLastRun: boolean;
  lastEvaluatedAt: string | null;
  evaluationsToday: number;
};

/**
 * Per-instrument scan coverage: whether each enabled instrument was included in
 * the most recent run and when it was last evaluated. Reporting only.
 */
export const instrumentCoverageQuery = () =>
  queryOptions({
    queryKey: ["scanner", "coverage"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<InstrumentCoverage[]> => {
      const [instruments, lastRun, candidates] = await Promise.all([
        unwrapList(
          db
            .from("instruments")
            .select("symbol, enabled, sort_order")
            .eq("enabled", true)
            .order("sort_order", { ascending: true }),
          { repo: "health.coverage.instruments" },
        ),
        unwrap(
          db
            .from("scanner_runs")
            .select("symbols_scanned")
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          { repo: "health.coverage.lastRun" },
        ),
        unwrapList(
          db
            .from("signal_candidates")
            .select("instrument, evaluated_at_utc")
            .eq("trading_day_utc", new Date().toISOString().slice(0, 10))
            .order("evaluated_at_utc", { ascending: false })
            .limit(1000),
          { repo: "health.coverage.candidates" },
        ),
      ]);

      const scanned = new Set(lastRun?.symbols_scanned ?? []);
      const seen = new Map<string, { last: string; count: number }>();
      for (const row of candidates) {
        const entry = seen.get(row.instrument);
        if (entry) entry.count += 1;
        else seen.set(row.instrument, { last: row.evaluated_at_utc, count: 1 });
      }

      return instruments.map((i) => ({
        instrument: i.symbol,
        scannedLastRun: scanned.has(i.symbol),
        lastEvaluatedAt: seen.get(i.symbol)?.last ?? null,
        evaluationsToday: seen.get(i.symbol)?.count ?? 0,
      }));
    },
  });



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

export type RetentionWindow = { table: string; keeps: string };

/** Retention windows enforced by the scheduled database cleanup. Display only. */
export const RETENTION_WINDOWS: RetentionWindow[] = [
  { table: "signal_rejections", keeps: "5 hours" },
  { table: "signal_candidates", keeps: "24 hours" },
  { table: "scanner_runs", keeps: "3 days" },
  { table: "scanner_errors", keeps: "7 days" },
];

export type PurgeRecord = {
  at: string;
  counts: { table: string; deleted: number }[];
};

/** Last automatic diagnostics purge, read from the audit log. */
export const lastPurgeQuery = () =>
  queryOptions({
    queryKey: ["audit_log", "purge", "latest"],
    refetchInterval: 300_000,
    queryFn: async (): Promise<PurgeRecord | null> => {
      const row = await unwrap(
        db
          .from("audit_log")
          .select("created_at, detail")
          .eq("action", "SCANNER_DIAGNOSTICS_PURGE")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        { repo: "health.lastPurge" },
      );
      if (!row) return null;
      const detail = (row.detail ?? {}) as Record<string, unknown>;
      return {
        at: row.created_at,
        counts: RETENTION_WINDOWS.map((w) => ({
          table: w.table,
          deleted: typeof detail[w.table] === "number" ? (detail[w.table] as number) : 0,
        })),
      };
    },
  });

export type FunnelStage = {
  stage: string;
  count: number;
  note: string;
};

export type ExecutionFunnel = {
  stages: FunnelStage[];
  topBlocking: { code: string; reason: string; count: number }[];
};

/**
 * The execution funnel for the current UTC trading day: detected -> armed ->
 * micro-triggered -> entry ready -> alerted, plus the reasons armed setups are
 * currently stuck. Reporting only: every number is read from stored rows.
 */
export const executionFunnelQuery = () =>
  queryOptions({
    queryKey: ["scanner", "funnel"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<ExecutionFunnel> => {
      const day = new Date().toISOString().slice(0, 10);
      const dayStart = `${day}T00:00:00.000Z`;

      const [signals, watches, alerts] = await Promise.all([
        unwrapList(
          db
            .from("signals")
            .select("id, lifecycle_state, armed_at, entry_ready_at")
            .eq("trading_day_utc", day)
            .limit(1000),
          { repo: "health.funnel.signals" },
        ),
        unwrapList(
          db
            .from("precision_watches")
            .select("id, state, entry_ready_at, metadata")
            .gte("armed_at", dayStart)
            .limit(1000),
          { repo: "health.funnel.watches" },
        ),
        unwrapList(
          db.from("notifications").select("id").gte("created_at", dayStart).limit(1000),
          { repo: "health.funnel.alerts" },
        ),
      ]);

      const armed = watches.length;
      const triggered = watches.filter(
        (w) => w.state === "MICRO_TRIGGERED" || w.entry_ready_at !== null,
      ).length;
      const entryReady = watches.filter((w) => w.entry_ready_at !== null).length;
      const open = watches.filter((w) => w.state === "ARMED" || w.state === "MICRO_TRIGGERED");

      const reasons = new Map<string, { reason: string; count: number }>();
      for (const w of open) {
        const meta = (w.metadata ?? {}) as { blocking?: { code: string; reason: string }[] };
        for (const b of meta.blocking ?? []) {
          const entry = reasons.get(b.code) ?? { reason: b.reason, count: 0 };
          entry.count += 1;
          reasons.set(b.code, entry);
        }
      }

      return {
        stages: [
          {
            stage: "Setups detected",
            count: signals.length,
            note: "Qualified setups stored today",
          },
          { stage: "Armed", count: armed, note: "Handed to the precision loop" },
          { stage: "Micro-triggered", count: triggered, note: "M1 sequence started" },
          { stage: "Entry ready", count: entryReady, note: "All execution gates passed" },
          { stage: "Alerted", count: alerts.length, note: "Notifications delivered" },
        ],
        topBlocking: [...reasons.entries()]
          .map(([code, v]) => ({ code, reason: v.reason, count: v.count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6),
      };
    },
  });

