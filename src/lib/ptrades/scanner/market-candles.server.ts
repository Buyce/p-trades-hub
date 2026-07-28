import type { Candle, Timeframe } from "./types";
import { TIMEFRAME_LABEL, TIMEFRAME_SECONDS } from "./types";

/**
 * Durable market-data plane.
 *
 * The scanner used to hold candle history in a module-level Map. On a
 * serverless worker that Map dies with the invocation, so every scheduled scan
 * re-downloaded five timeframes for every instrument through a single broker
 * resource slot — which is exactly why context runs overran their lock and were
 * skipped for hours at a time.
 *
 * The store below is the single source of truth for history. A dedicated
 * `sync-market-data` pass writes it; the context scan only ever READS it. That
 * separation is what makes the context scan short enough to finish.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export type StoredSeries = {
  candles: Candle[];
  /** Age of the newest stored candle's close, in seconds. */
  ageSeconds: number | null;
};

const EMPTY: StoredSeries = { candles: [], ageSeconds: null };

function rowToCandle(row: {
  open_time: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string | null;
}): Candle {
  return {
    time: new Date(row.open_time).toISOString(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume === null ? null : Number(row.volume),
  };
}

/** Persists a normalised, closed-candle series. Upsert — never destructive. */
export async function storeCandles(
  admin: Admin,
  args: { instrument: string; brokerSymbol: string; timeframe: Timeframe; candles: Candle[] },
): Promise<number> {
  const { instrument, brokerSymbol, timeframe, candles } = args;
  if (candles.length === 0) return 0;
  const rows = candles.map((c) => ({
    instrument,
    broker_symbol: brokerSymbol,
    timeframe: TIMEFRAME_LABEL[timeframe],
    open_time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    fetched_at: new Date().toISOString(),
  }));
  const { error } = await admin
    .from("market_candles")
    .upsert(rows, { onConflict: "broker_symbol,timeframe,open_time" });
  if (error) {
    console.error("market candle store failed", error.message);
    return 0;
  }
  return rows.length;
}

/** Reads the most recent `limit` closed candles, oldest first. */
export async function readCandles(
  admin: Admin,
  args: { brokerSymbol: string; timeframe: Timeframe; limit: number },
): Promise<StoredSeries> {
  const { data, error } = await admin
    .from("market_candles")
    .select("open_time, open, high, low, close, volume")
    .eq("broker_symbol", args.brokerSymbol)
    .eq("timeframe", TIMEFRAME_LABEL[args.timeframe])
    .order("open_time", { ascending: false })
    .limit(args.limit);
  if (error) {
    console.error("market candle read failed", error.message);
    return EMPTY;
  }
  const candles = (data ?? []).map(rowToCandle).reverse();
  return { candles, ageSeconds: seriesAgeSeconds(candles, args.timeframe) };
}

/** Reads every required timeframe for one symbol in a single round trip each. */
export async function readSeries(
  admin: Admin,
  args: { brokerSymbol: string; timeframes: Timeframe[]; limit: number },
): Promise<Record<string, StoredSeries>> {
  const entries = await Promise.all(
    args.timeframes.map(
      async (tf) =>
        [
          tf,
          await readCandles(admin, {
            brokerSymbol: args.brokerSymbol,
            timeframe: tf,
            limit: args.limit,
          }),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/**
 * Seconds since the last stored candle CLOSED. Measured from the close, not the
 * open, so a freshly closed bar reads as zero seconds old.
 */
export function seriesAgeSeconds(
  candles: Candle[],
  timeframe: Timeframe,
  now = Date.now(),
): number | null {
  const last = candles.at(-1);
  if (!last) return null;
  const closeMs = Date.parse(last.time) + TIMEFRAME_SECONDS[timeframe] * 1000;
  return Math.max(0, Math.round((now - closeMs) / 1000));
}

/**
 * Whether a stored series is fresh enough to make a decision on. A series is
 * allowed to be one full interval old plus the feed budget, because the newest
 * bar necessarily ages a whole interval before its successor closes.
 */
export function isStoreFresh(
  ageSeconds: number | null,
  timeframe: Timeframe,
  feedBudgetSeconds: number,
): boolean {
  if (ageSeconds === null) return false;
  return ageSeconds <= feedBudgetSeconds + TIMEFRAME_SECONDS[timeframe];
}
