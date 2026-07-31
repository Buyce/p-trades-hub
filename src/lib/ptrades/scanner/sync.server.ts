import type { Candle, Timeframe } from "./types";
import { TIMEFRAME_LABEL, TIMEFRAME_SECONDS } from "./types";
import { marketData } from "./market-data.server";
import { normaliseCandles } from "./candles.server";
import { recordScannerError } from "./errors.server";
import { AppError } from "../errors";
import type { InstrumentRow } from "./symbols.server";
import { readCandles, storeCandles } from "./market-candles.server";
import { createDeadline, renewScanLock, SYNC_LOCK_KEY } from "./lock.server";
import { safeHeartbeat } from "./heartbeat.server";

/**
 * Market-data sync pass — the ONLY component that talks to the broker for
 * history.
 *
 * Separating the data plane from the decision plane is the whole point. The
 * context scan previously spent its entire lock budget downloading five
 * timeframes per instrument through a single broker resource slot, so it
 * routinely never reached the part where it decides anything. Now this pass
 * owns the downloads and writes them to `market_candles`; the context scan
 * reads that table and finishes in a fraction of the time.
 *
 * A timeframe is only re-fetched when its bar has actually closed since the
 * last stored bar. Nothing new can exist before then, so re-reading it is pure
 * waste of the one resource slot.
 *
 * SAFETY: read-only against the broker. It cannot place, modify or close a
 * trade.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const SYNC_TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "1h", "4h", "1d"];

/**
 * Per-call broker budget. Measured production latency: intraday candle reads
 * return in ~90-700ms, but D1/H4 history regularly takes 1.7-4.2s and has been
 * observed at 4.2s, so a flat 5s cap was killing D1 syncs (EURUSD/1d) and
 * leaving daily bias data days stale. Higher-timeframe reads get a wider
 * budget; the pass deadline still bounds the whole run.
 */
const FETCH_TIMEOUT_MS = 5_000;
const MEDIUM_TIMEFRAME_TIMEOUT_MS = 8_000;
const SLOW_TIMEFRAME_TIMEOUT_MS = 12_000;
/**
 * M1 is the execution timeframe: without it no watch can ever trigger, so it
 * gets its own budget and a single retry instead of sharing the generic
 * intraday cap that was silently timing out at 5s on XAUUSD.
 */
const MICRO_TIMEFRAME_TIMEOUT_MS = 10_000;

function fetchTimeoutFor(tf: Timeframe): number {
  if (tf === "1d" || tf === "4h") return SLOW_TIMEFRAME_TIMEOUT_MS;
  if (tf === "M15" || tf === "1h") return MEDIUM_TIMEFRAME_TIMEOUT_MS;
  if (tf === "M1") return MICRO_TIMEFRAME_TIMEOUT_MS;
  return FETCH_TIMEOUT_MS;
}

/** One scheduled tick is a minute; stop well before the next one fires. */
export const SYNC_BUDGET_MS = 35_000;
export const SYNC_LOCK_TTL_SECONDS = 55;

export function barsFor(tf: Timeframe): number {
  if (tf === "1d" || tf === "M1") return 120;
  return 200;
}

/**
 * True when a new bar of this timeframe has closed since `lastStored`. Compares
 * CLOSE BUCKETS, not wall-clock TTLs: a timeframe cannot produce information
 * between two closes, so there is nothing to fetch.
 */
export function needsRefresh(
  lastStoredOpenTime: string | null,
  tf: Timeframe,
  nowMs = Date.now(),
): boolean {
  if (!lastStoredOpenTime) return true;
  const seconds = TIMEFRAME_SECONDS[tf];
  const storedBucket = Math.floor(Date.parse(lastStoredOpenTime) / 1000 / seconds);
  // The bar currently forming is `nowBucket`; the newest CLOSED bar is one
  // before it.
  const lastClosedBucket = Math.floor(nowMs / 1000 / seconds) - 1;
  return storedBucket < lastClosedBucket;
}

export type SyncSummary = {
  ok: boolean;
  instruments: number;
  fetched: number;
  skipped: number;
  stored: number;
  failures: Array<{ instrument: string; timeframe: string; error: string }>;
  reads: Array<{
    instrument: string;
    timeframe: string;
    status: "FETCHED" | "UP_TO_DATE" | "FAILED";
    latencyMs: number;
    ageSeconds: number | null;
  }>;
  durationMs: number;
  deadlineHit: boolean;
};

/** Syncs one instrument's timeframes into the durable store. */
async function syncInstrument(
  admin: Admin,
  instrument: InstrumentRow,
  summary: SyncSummary,
  deadline: ReturnType<typeof createDeadline>,
  timeframes: Timeframe[] = SYNC_TIMEFRAMES,
): Promise<void> {
  const brokerSymbol = instrument.broker_symbol;
  if (!brokerSymbol) {
    summary.failures.push({
      instrument: instrument.symbol,
      timeframe: timeframes.map((tf) => TIMEFRAME_LABEL[tf]).join(","),
      error: "No configured broker_symbol; provider lookup is disabled in scheduled passes.",
    });
    return;
  }

  for (const tf of timeframes) {
    if (deadline.expired()) {
      summary.deadlineHit = true;
      return;
    }
    const existing = await readCandles(admin, { brokerSymbol, timeframe: tf, limit: 1 });
    const lastOpen = existing.candles.at(-1)?.time ?? null;
    if (!needsRefresh(lastOpen, tf)) {
      summary.skipped += 1;
      summary.reads.push({ instrument: instrument.symbol, timeframe: TIMEFRAME_LABEL[tf], status: "UP_TO_DATE", latencyMs: 0, ageSeconds: existing.ageSeconds });
      continue;
    }

    const fetchStartedAt = Date.now();
    try {
      const raw = await marketData().getCandles(brokerSymbol, tf, barsFor(tf), {
        timeoutMs: Math.min(fetchTimeoutFor(tf), Math.max(1, deadline.remainingMs())),
      });

      summary.fetched += 1;
      const normalised = normaliseCandles(raw, tf);
      const malformed = normalised.rejected.filter((r) => r.reason !== "NOT_CLOSED");
      if (malformed.length) {
        await recordScannerError(admin, {
          runId: null,
          instrument: instrument.symbol,
          stage: "NORMALISATION",
          error: new AppError(
            "VALIDATION",
            `${malformed.length} malformed candle(s) dropped on ${TIMEFRAME_LABEL[tf]}`,
          ),
          detail: { broker_symbol: brokerSymbol, rejects: malformed.slice(0, 20) },
        });
      }
      summary.stored += await storeCandles(admin, {
        instrument: instrument.symbol,
        brokerSymbol,
        timeframe: tf,
        candles: normalised.candles as Candle[],
      });
      summary.reads.push({ instrument: instrument.symbol, timeframe: TIMEFRAME_LABEL[tf], status: "FETCHED", latencyMs: Date.now() - fetchStartedAt, ageSeconds: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "fetch failed";
      summary.failures.push({
        instrument: instrument.symbol,
        timeframe: TIMEFRAME_LABEL[tf],
        error: message,
      });
      summary.reads.push({ instrument: instrument.symbol, timeframe: TIMEFRAME_LABEL[tf], status: "FAILED", latencyMs: Date.now() - fetchStartedAt, ageSeconds: existing.ageSeconds });
      await recordScannerError(admin, {
        runId: null,
        instrument: instrument.symbol,
        stage: "MARKET_DATA",
        error,
        detail: { broker_symbol: brokerSymbol, timeframe: TIMEFRAME_LABEL[tf] },
      });
    }
  }
}

/** One full sync pass across every enabled instrument. */
export async function runMarketDataSync(admin: Admin, holder: string): Promise<SyncSummary> {
  const deadline = createDeadline(SYNC_BUDGET_MS);
  const summary: SyncSummary = {
    ok: true,
    instruments: 0,
    fetched: 0,
    skipped: 0,
    stored: 0,
    failures: [],
    reads: [],
    durationMs: 0,
    deadlineHit: false,
  };

  if (!marketData().isConfigured()) {
    summary.ok = false;
    summary.durationMs = deadline.elapsedMs();
    await safeHeartbeat(admin, {
      source: "MARKET_DATA_SYNC",
      status: "ERROR",
      metaapiConnected: false,
      rulebookVersion: null,
      detail: { reason: "MetaApi is not configured." },
    });
    return summary;
  }

  const { data: instruments } = await admin
    .from("instruments")
    .select(
      "symbol, broker_symbol, aliases, digits, point_size, contract_size, base_currency, quote_currency, sessions, min_rr, max_spread, max_data_age_seconds",
    )
    .eq("enabled", true)
    .order("sort_order");

  const rows = (instruments ?? []) as InstrumentRow[];
  // M1 is the execution timeframe: precision cannot trigger without it, so
  // EVERY instrument gets one bounded M1 attempt before anything slower is
  // considered. Provider history reads are serialized, so launching these via
  // Promise.all only built a queue of abandoned requests after caller timeouts.
  const microTimeframes: Timeframe[] = ["M1"];
  const slowTimeframes = SYNC_TIMEFRAMES.filter((tf) => !microTimeframes.includes(tf));

  summary.instruments = rows.length;
  for (const instrument of rows) {
    if (deadline.expired()) {
      summary.deadlineHit = true;
      break;
    }
    await syncInstrument(admin, instrument, summary, deadline, microTimeframes);
  }
  await renewScanLock(admin, SYNC_LOCK_KEY, holder, SYNC_LOCK_TTL_SECONDS);

  // The slower frames change at most once an hour, so they keep the rotation:
  // fair recovery without spending the tick's remaining budget on data that
  // cannot have changed.
  const rotation = rows.length > 0 ? Math.floor(Date.now() / 60_000) % rows.length : 0;
  const orderedRows = [...rows.slice(rotation), ...rows.slice(0, rotation)];
  for (const instrument of orderedRows) {
    if (deadline.expired()) {
      summary.deadlineHit = true;
      break;
    }
    await syncInstrument(admin, instrument, summary, deadline, slowTimeframes);
    // Prove liveness so a healthy but slow pass is never evicted mid-flight.
    await renewScanLock(admin, SYNC_LOCK_KEY, holder, SYNC_LOCK_TTL_SECONDS);
  }

  summary.durationMs = deadline.elapsedMs();
  summary.ok = summary.failures.length < Math.max(1, summary.instruments);

  // Per-symbol M1 health, reported explicitly. Starvation of the execution
  // timeframe is the single failure that silences the whole alert pipeline, so
  // it must be readable at a glance instead of inferred from a read list.
  const microHealth = rows.map((row) => {
    const read = summary.reads.find(
      (r) => r.instrument === row.symbol && r.timeframe === TIMEFRAME_LABEL.M1,
    );
    return {
      instrument: row.symbol,
      status: read?.status ?? "NOT_REACHED",
      age_seconds: read?.ageSeconds ?? null,
      latency_ms: read?.latencyMs ?? null,
    };
  });
  const microStarved = microHealth.filter((m) => m.status === "FAILED" || m.status === "NOT_REACHED");

  await safeHeartbeat(admin, {
    source: "MARKET_DATA_SYNC",
    status:
      microStarved.length > 0
        ? "ERROR"
        : summary.failures.length === 0
          ? "OK"
          : "DEGRADED",
    metaapiConnected: summary.failures.length === 0,
    rulebookVersion: null,
    detail: {
      instruments: summary.instruments,
      timeframes_fetched: summary.fetched,
      timeframes_up_to_date: summary.skipped,
      candles_stored: summary.stored,
      micro_health: microHealth,
      micro_starved: microStarved.map((m) => m.instrument),
      failures: summary.failures.slice(0, 20),
      reads: summary.reads,
      deadline_hit: summary.deadlineHit,
      duration_ms: summary.durationMs,
      completed_at: new Date().toISOString(),
      lock_holder: holder,
    },
  });

  return summary;
}
