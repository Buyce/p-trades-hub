import { queryOptions } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
import { db, unwrap, unwrapList } from "./client";
import { utcTradingDay } from "../time";

/** Read-only repository for scanner-owned signal records. */

export type Signal = Tables<"signals">;

export const signalsTodayQuery = () =>
  queryOptions({
    queryKey: ["signals", "today", utcTradingDay()],
    queryFn: () =>
      unwrapList(
        db
          .from("signals")
          .select("*")
          .eq("trading_day_utc", utcTradingDay())
          .order("signal_time_utc", { ascending: false }),
        { repo: "signals.today" },
      ),
  });

export const recentSignalsQuery = (limit = 50) =>
  queryOptions({
    queryKey: ["signals", "recent", limit],
    queryFn: () =>
      unwrapList(
        db.from("signals").select("*").order("signal_time_utc", { ascending: false }).limit(limit),
        { repo: "signals.recent" },
      ),
  });

export const signalQuery = (id: string) =>
  queryOptions({
    queryKey: ["signal", id],
    queryFn: () =>
      unwrap(db.from("signals").select("*").eq("id", id).maybeSingle(), {
        repo: "signals.byId",
        id,
      }),
  });
