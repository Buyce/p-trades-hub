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
