import { queryOptions } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
import { db, requireUserId, unwrapList } from "./client";
import { AppError, fromPostgrest } from "../errors";

/** Repository for the user's own trades and trade events. */

export type Trade = Tables<"trades">;
export type TradeEvent = Tables<"trade_events">;

export const myTradesQuery = () =>
  queryOptions({
    queryKey: ["trades"],
    queryFn: () =>
      unwrapList(db.from("trades").select("*").order("opened_at", { ascending: false }), {
        repo: "trades.mine",
      }),
  });

export const tradeEventsQuery = (tradeId: string) =>
  queryOptions({
    queryKey: ["trade_events", tradeId],
    queryFn: () =>
      unwrapList(
        db
          .from("trade_events")
          .select("*")
          .eq("trade_id", tradeId)
          .order("occurred_at", { ascending: false }),
        { repo: "trades.events", tradeId },
      ),
  });

export async function createTrade(input: {
  userId: string | undefined;
  instrument: string;
  direction: string;
  entryPrice?: number | null;
  stopPrice?: number | null;
  signalId?: string | null;
}): Promise<void> {
  const userId = requireUserId(input.userId);
  const instrument = input.instrument.trim().toUpperCase();
  if (!instrument) throw new AppError("VALIDATION", "instrument is required");
  const { error } = await db.from("trades").insert({
    user_id: userId,
    signal_id: input.signalId ?? null,
    instrument,
    direction: input.direction,
    entry_price: input.entryPrice ?? null,
    stop_price: input.stopPrice ?? null,
    planned_entry: input.entryPrice ?? null,
    planned_stop: input.stopPrice ?? null,
  });
  if (error) throw fromPostgrest(error, { repo: "trades.create" });
}

/**
 * Closes a journal entry with the realised R multiple the user reports.
 * The outcome label is a record of what the user entered, not a calculation
 * of trading logic.
 */
export async function closeTrade(input: {
  tradeId: string;
  rMultiple: number;
}): Promise<void> {
  if (!Number.isFinite(input.rMultiple)) {
    throw new AppError("VALIDATION", "a realised R multiple is required");
  }
  const { error } = await db
    .from("trades")
    .update({
      status: "CLOSED",
      r_multiple: input.rMultiple,
      outcome: input.rMultiple > 0 ? "WIN" : input.rMultiple < 0 ? "LOSS" : "BREAKEVEN",
      closed_at: new Date().toISOString(),
    })
    .eq("id", input.tradeId);
  if (error) throw fromPostgrest(error, { repo: "trades.close" });
}
