import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

/**
 * Read-only adapters over the cloud database.
 * Swap the bodies here to point at a different source — screens only use these.
 * No trading logic lives in this file (or anywhere in the frontend).
 */

export type Signal = Tables<"signals">;
export type SignalDecision = Tables<"signal_decisions">;
export type Trade = Tables<"trades">;
export type TradeEvent = Tables<"trade_events">;
export type Heartbeat = Tables<"system_heartbeats">;
export type ScannerRun = Tables<"scanner_runs">;
export type RulebookVersion = Tables<"rulebook_versions">;
export type MacroEvent = Tables<"macro_events">;
export type Profile = Tables<"profiles">;

export const MAX_DAILY_ALERTS = 2;

export function utcTradingDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function unwrap<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export const signalsTodayQuery = () =>
  queryOptions({
    queryKey: ["signals", "today", utcTradingDay()],
    queryFn: async () =>
      (await unwrap(
        supabase
          .from("signals")
          .select("*")
          .eq("trading_day_utc", utcTradingDay())
          .order("signal_time_utc", { ascending: false }),
      )) ?? [],
  });

export const recentSignalsQuery = (limit = 50) =>
  queryOptions({
    queryKey: ["signals", "recent", limit],
    queryFn: async () =>
      (await unwrap(
        supabase
          .from("signals")
          .select("*")
          .order("signal_time_utc", { ascending: false })
          .limit(limit),
      )) ?? [],
  });

export const signalQuery = (id: string) =>
  queryOptions({
    queryKey: ["signal", id],
    queryFn: async () =>
      await unwrap(supabase.from("signals").select("*").eq("id", id).maybeSingle()),
  });

export const myDecisionsQuery = () =>
  queryOptions({
    queryKey: ["signal_decisions"],
    queryFn: async () =>
      (await unwrap(
        supabase.from("signal_decisions").select("*").order("decided_at", { ascending: false }),
      )) ?? [],
  });

export const myTradesQuery = () =>
  queryOptions({
    queryKey: ["trades"],
    queryFn: async () =>
      (await unwrap(supabase.from("trades").select("*").order("opened_at", { ascending: false }))) ??
      [],
  });

export const tradeEventsQuery = (tradeId: string) =>
  queryOptions({
    queryKey: ["trade_events", tradeId],
    queryFn: async () =>
      (await unwrap(
        supabase
          .from("trade_events")
          .select("*")
          .eq("trade_id", tradeId)
          .order("occurred_at", { ascending: false }),
      )) ?? [],
  });

export const latestHeartbeatQuery = () =>
  queryOptions({
    queryKey: ["heartbeat", "latest"],
    refetchInterval: 60_000,
    queryFn: async () =>
      await unwrap(
        supabase
          .from("system_heartbeats")
          .select("*")
          .order("received_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
  });

export const heartbeatHistoryQuery = (limit = 30) =>
  queryOptions({
    queryKey: ["heartbeat", "history", limit],
    queryFn: async () =>
      (await unwrap(
        supabase
          .from("system_heartbeats")
          .select("*")
          .order("received_at", { ascending: false })
          .limit(limit),
      )) ?? [],
  });

export const instrumentsQuery = () =>
  queryOptions({
    queryKey: ["instruments"],
    queryFn: async () =>
      (await unwrap(
        supabase
          .from("instruments")
          .select("*")
          .order("sort_order", { ascending: true })
          .order("symbol", { ascending: true }),
      )) ?? [],
  });

export const scannerRunsQuery = (limit = 25) =>

  queryOptions({
    queryKey: ["scanner_runs", limit],
    queryFn: async () =>
      (await unwrap(
        supabase
          .from("scanner_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(limit),
      )) ?? [],
  });

export const activeRulebookQuery = () =>
  queryOptions({
    queryKey: ["rulebook", "active"],
    queryFn: async () =>
      await unwrap(
        supabase
          .from("rulebook_versions")
          .select("*")
          .eq("is_active", true)
          .order("effective_from", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
  });

export const rulebookVersionsQuery = () =>
  queryOptions({
    queryKey: ["rulebook", "all"],
    queryFn: async () =>
      (await unwrap(
        supabase
          .from("rulebook_versions")
          .select("*")
          .order("effective_from", { ascending: false }),
      )) ?? [],
  });

export const macroEventsQuery = () =>
  queryOptions({
    queryKey: ["macro_events"],
    queryFn: async () =>
      (await unwrap(
        supabase
          .from("macro_events")
          .select("*")
          .gte("event_time_utc", new Date(Date.now() - 86_400_000).toISOString())
          .order("event_time_utc", { ascending: true }),
      )) ?? [],
  });

export const myProfileQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      await unwrap(supabase.from("profiles").select("*").eq("id", userId!).maybeSingle()),
  });

export const myRolesQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["roles", userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      (await unwrap(supabase.from("user_roles").select("role").eq("user_id", userId!))) ?? [],
  });

/* ---- journal / performance analytics (reporting only, not trading logic) ---- */

export function closedTrades(trades: Trade[]) {
  return trades.filter((t) => t.status === "CLOSED" && t.r_multiple !== null);
}

export function expectancy(trades: Trade[]): number | null {
  const closed = closedTrades(trades);
  if (closed.length === 0) return null;
  const total = closed.reduce((sum, t) => sum + Number(t.r_multiple ?? 0), 0);
  return total / closed.length;
}

export function winRate(trades: Trade[]): number | null {
  const closed = closedTrades(trades);
  if (closed.length === 0) return null;
  return closed.filter((t) => Number(t.r_multiple) > 0).length / closed.length;
}

export function tradesSince(trades: Trade[], sinceMs: number) {
  return trades.filter((t) => new Date(t.opened_at).getTime() >= sinceMs);
}
