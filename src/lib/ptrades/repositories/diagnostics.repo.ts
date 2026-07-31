import { queryOptions } from "@tanstack/react-query";
import { db, unwrapList } from "./client";

/**
 * Per-instrument availability diagnostics.
 *
 * Answers one question for each watched instrument: "why is there no alert
 * right now, and exactly when did that become true?" Every value is read from
 * stored rows — candle freshness, stored gate rejections, precision watch
 * state and scanner errors. Nothing here re-evaluates a rule, re-scores a
 * setup or infers a reason the backend did not record.
 */

/** Timeframes whose freshness decides whether an instrument can be scanned. */
const CRITICAL_TIMEFRAMES = ["M1", "M15"] as const;

/** Interval of each timeframe in seconds, used to age the last closed bar. */
const TIMEFRAME_SECONDS: Record<string, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  H1: 3_600,
  H4: 14_400,
  D1: 86_400,
};

/**
 * How late a timeframe may be before it is reported as missing. One full bar
 * of slack on top of the interval, because the newest closed bar is by
 * definition one interval old.
 */
function feedLimitSeconds(timeframe: string): number {
  const interval = TIMEFRAME_SECONDS[timeframe] ?? 900;
  return interval * 2 + 120;
}

export type FeedStatus = {
  timeframe: string;
  lastBarTime: string | null;
  fetchedAt: string | null;
  ageSeconds: number | null;
  limitSeconds: number;
  stale: boolean;
};

export type ReasonCode = {
  /** Machine code exactly as the backend recorded it, e.g. STALE_DATA. */
  code: string;
  /** The backend's own wording. Never rewritten here. */
  reason: string;
  /** When this reason was last true. */
  at: string | null;
  /** How many times it was recorded in the current window. */
  count: number;
  source: "feed" | "gate" | "precision" | "error";
};

export type InstrumentDiagnostics = {
  instrument: string;
  enabled: boolean;
  /** The single reason that is currently holding this instrument back. */
  primary: ReasonCode | null;
  feeds: FeedStatus[];
  gates: ReasonCode[];
  precision: {
    state: string | null;
    armedAt: string | null;
    triggeredAt: string | null;
    entryReadyAt: string | null;
    resolvedAt: string | null;
    lastCheckedAt: string | null;
    checkCount: number | null;
    /** Seconds between the setup arming and it resolving or now. */
    ageSeconds: number | null;
    blocking: ReasonCode[];
  } | null;
  lastEvaluatedAt: string | null;
  lastCandidateQualified: boolean | null;
  errors: ReasonCode[];
};

function ageSeconds(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now - t) / 1000));
}

/**
 * Ordering matters: the first reason that is true is the one to fix. Missing
 * data outranks a gate rejection, because a gate cannot pass on data that
 * never arrived.
 */
function choosePrimary(d: Omit<InstrumentDiagnostics, "primary">): ReasonCode | null {
  if (!d.enabled) {
    return {
      code: "INSTRUMENT_DISABLED",
      reason: "This instrument is switched off in the scanner configuration.",
      at: null,
      count: 1,
      source: "gate",
    };
  }

  const missing = d.feeds.filter((f) => f.stale);
  if (missing.length > 0) {
    const worst = missing.sort((a, b) => (b.ageSeconds ?? 0) - (a.ageSeconds ?? 0))[0];
    return {
      code: worst.lastBarTime === null ? `MISSING_${worst.timeframe}` : `STALE_${worst.timeframe}`,
      reason:
        worst.lastBarTime === null
          ? `No ${worst.timeframe} candles are stored for this instrument.`
          : `${worst.timeframe} feed is ${worst.ageSeconds}s behind its last closed bar (limit ${worst.limitSeconds}s).`,
      at: worst.lastBarTime,
      count: missing.length,
      source: "feed",
    };
  }

  const open = d.precision;
  if (open && (open.state === "ARMED" || open.state === "MICRO_TRIGGERED")) {
    const blocking = open.blocking[0];
    return (
      blocking ?? {
        code: open.state === "ARMED" ? "AWAITING_TRIGGER" : "AWAITING_CONFIRMATION",
        reason:
          open.state === "ARMED"
            ? "Armed and waiting for the M1 execution trigger."
            : "Trigger fired; waiting for the confirming close.",
        at: open.armedAt,
        count: 1,
        source: "precision",
      }
    );
  }

  if (d.gates.length > 0) return d.gates[0];
  if (d.errors.length > 0) return d.errors[0];
  return null;
}

/**
 * Diagnostics for every configured instrument, newest state first. Refreshes
 * on the scanner's own cadence so the reason and its timestamp stay current.
 */
export const instrumentDiagnosticsQuery = () =>
  queryOptions({
    queryKey: ["scanner", "diagnostics"],
    refetchInterval: 30_000,
    queryFn: async (): Promise<InstrumentDiagnostics[]> => {
      const now = Date.now();
      const day = new Date(now).toISOString().slice(0, 10);
      const sinceCandles = new Date(now - 6 * 3_600_000).toISOString();
      const sinceWatches = new Date(now - 12 * 3_600_000).toISOString();
      const sinceErrors = new Date(now - 3 * 3_600_000).toISOString();

      const [instruments, candles, rejections, watches, candidates, errors] = await Promise.all([
        unwrapList(
          db
            .from("instruments")
            .select("symbol, enabled, sort_order")
            .order("sort_order", { ascending: true }),
          { repo: "diagnostics.instruments" },
        ),
        unwrapList(
          db
            .from("market_candles")
            .select("instrument, timeframe, open_time, fetched_at")
            .in("timeframe", [...CRITICAL_TIMEFRAMES])
            .gte("open_time", sinceCandles)
            .order("open_time", { ascending: false })
            .limit(2000),
          { repo: "diagnostics.candles" },
        ),
        unwrapList(
          db
            .from("signal_rejections")
            .select("instrument, gate_code, reason, created_at")
            .eq("trading_day_utc", day)
            .order("created_at", { ascending: false })
            .limit(1000),
          { repo: "diagnostics.rejections" },
        ),
        unwrapList(
          db
            .from("precision_watches")
            .select(
              "symbol, state, armed_at, triggered_at, entry_ready_at, resolved_at, last_checked_at, check_count, metadata",
            )
            .gte("armed_at", sinceWatches)
            .order("armed_at", { ascending: false })
            .limit(500),
          { repo: "diagnostics.watches" },
        ),
        unwrapList(
          db
            .from("signal_candidates")
            .select("instrument, evaluated_at_utc, qualified")
            .eq("trading_day_utc", day)
            .order("evaluated_at_utc", { ascending: false })
            .limit(1000),
          { repo: "diagnostics.candidates" },
        ),
        unwrapList(
          db
            .from("scanner_errors")
            .select("instrument, stage, error_code, message, occurred_at")
            .gte("occurred_at", sinceErrors)
            .order("occurred_at", { ascending: false })
            .limit(300),
          { repo: "diagnostics.errors" },
        ),
      ]);

      // Newest stored bar per instrument and timeframe.
      const feedMap = new Map<string, { open: string; fetched: string }>();
      for (const row of candles) {
        const key = `${row.instrument}|${row.timeframe}`;
        if (!feedMap.has(key)) feedMap.set(key, { open: row.open_time, fetched: row.fetched_at });
      }

      return instruments.map((instrument) => {
        const symbol = instrument.symbol;

        const feeds: FeedStatus[] = CRITICAL_TIMEFRAMES.map((timeframe) => {
          const entry = feedMap.get(`${symbol}|${timeframe}`) ?? null;
          const age = ageSeconds(entry?.open ?? null, now);
          const limit = feedLimitSeconds(timeframe);
          return {
            timeframe,
            lastBarTime: entry?.open ?? null,
            fetchedAt: entry?.fetched ?? null,
            ageSeconds: age,
            limitSeconds: limit,
            stale: entry === null || (age ?? Number.POSITIVE_INFINITY) > limit,
          };
        });

        // Stored gate rejections for today, most frequent first, each carrying
        // the timestamp of the most recent occurrence.
        const gateMap = new Map<string, ReasonCode>();
        for (const row of rejections) {
          if (row.instrument !== symbol) continue;
          const existing = gateMap.get(row.gate_code);
          if (existing) existing.count += 1;
          else
            gateMap.set(row.gate_code, {
              code: row.gate_code,
              reason: row.reason,
              at: row.created_at,
              count: 1,
              source: "gate",
            });
        }
        const gates = [...gateMap.values()].sort((a, b) => b.count - a.count);

        const watch = watches.find((w) => w.symbol === symbol) ?? null;
        const meta = (watch?.metadata ?? {}) as {
          blocking?: { code?: string; reason?: string }[];
        };
        const blocking: ReasonCode[] = (meta.blocking ?? []).map((b) => ({
          code: b.code ?? "BLOCKED",
          reason: b.reason ?? "The precision loop recorded a blocking condition.",
          at: watch?.last_checked_at ?? watch?.armed_at ?? null,
          count: 1,
          source: "precision" as const,
        }));

        const precision = watch
          ? {
              state: watch.state,
              armedAt: watch.armed_at,
              triggeredAt: watch.triggered_at,
              entryReadyAt: watch.entry_ready_at,
              resolvedAt: watch.resolved_at,
              lastCheckedAt: watch.last_checked_at,
              checkCount: watch.check_count,
              ageSeconds:
                watch.armed_at === null
                  ? null
                  : Math.max(
                      0,
                      Math.round(
                        ((watch.resolved_at ? Date.parse(watch.resolved_at) : now) -
                          Date.parse(watch.armed_at)) /
                          1000,
                      ),
                    ),
              blocking,
            }
          : null;

        const candidate = candidates.find((c) => c.instrument === symbol) ?? null;

        const instrumentErrors: ReasonCode[] = errors
          .filter((e) => e.instrument === symbol)
          .slice(0, 3)
          .map((e) => ({
            code: `${e.stage}:${e.error_code}`,
            reason: e.message,
            at: e.occurred_at,
            count: 1,
            source: "error" as const,
          }));

        const base = {
          instrument: symbol,
          enabled: instrument.enabled,
          feeds,
          gates,
          precision,
          lastEvaluatedAt: candidate?.evaluated_at_utc ?? null,
          lastCandidateQualified: candidate?.qualified ?? null,
          errors: instrumentErrors,
        };

        return { ...base, primary: choosePrimary(base) };
      });
    },
  });
