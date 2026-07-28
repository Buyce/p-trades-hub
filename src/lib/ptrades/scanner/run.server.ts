import type { Bias, Candidate, Candle, GateResult, Rulebook, Timeframe } from "./types";
import {
  DEFAULT_RULEBOOK,
  TIMEFRAME_LABEL,
  TIMEFRAME_SECONDS,
  candleGapMultipleFor,
  isUnlimitedCap,
} from "./types";

import { marketData } from "./market-data.server";

import { dataAgeSeconds, lastClosed, normaliseCandles, type CandleReject } from "./candles.server";
import { recordScannerError } from "./errors.server";
import { AppError } from "../errors";
import { atr } from "./atr.server";
import { higherTimeframeBias } from "./bias.server";
import { checkLateEntry } from "./late-entry.server";
import { fingerprint } from "./fingerprint.server";
import { rulebookChecksum } from "./rulebook.server";
import { minTierRr, scoreCandidate, tierFor } from "./scoring.server";
import { rewardToRisk, structuralTargets } from "./risk.server";
import { swingHighs, swingLows } from "./swings.server";
import { detectSetup } from "./setups.server";
import { checkCandleSanity } from "./sanity.server";
import { sessionAt } from "./sessions.server";
import { currenciesFor, macroContextFor, type MacroEvent } from "./macro.server";
import { resolveSymbol, roundToDigits, type InstrumentRow } from "./symbols.server";
import { acquireScanLock, releaseScanLock } from "./lock.server";
import {
  biasConflict,
  candleSanity,
  dailyCap,
  duplicate,
  expiry,
  failedGates,
  invalidStop,
  lateEntry,
  missingData,
  newsLockout,
  noSetup,
  rrGate,
  sessionGate,
  spreadGate,
  staleData,
} from "./gates.server";
import { tierBucket, type Tier } from "../tiers";
import {
  actionableCountToday,
  closeStaleRuns,
  cacheCandle,
  claimActionableSlot,
  fingerprintExistsToday,
  finishRun,
  promoteToSignal,
  saveCandidate,
  saveRejections,
  startRun,
  tradingDayUtc,
} from "./persist.server";
import { notifyQualifiedSignal } from "./notify.server";
import { writeHeartbeat } from "./heartbeat.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const ENTRY_TF: Timeframe = "M15";
const REQUIRED: Timeframe[] = ["M5", "M15", "1h", "4h", "1d"];

export type ScanSummary = {
  ok: boolean;
  shadowMode: boolean;
  scanned: string[];
  candidates: number;
  qualified: number;
  actionable: number;
  rejections: number;
  message?: string;
};

function parseRulebook(row: { version: string; rules: unknown } | null): Rulebook {
  if (!row) return DEFAULT_RULEBOOK;
  const rules = (row.rules ?? {}) as Partial<Rulebook>;
  return { ...DEFAULT_RULEBOOK, ...rules, version: row.version };
}

async function loadMacroEvents(admin: Admin): Promise<MacroEvent[]> {
  const now = Date.now();
  const from = new Date(now - 6 * 3600_000).toISOString();
  const to = new Date(now + 6 * 3600_000).toISOString();
  const { data } = await admin
    .from("macro_events")
    .select("title, currency, impact, event_time_utc, lockout_start_utc, lockout_end_utc, symbols")
    .gte("event_time_utc", from)
    .lte("event_time_utc", to);
  return (data ?? []) as MacroEvent[];
}

/**
 * Target ladder for a candidate. Structure first — the next opposing liquidity
 * levels ahead of the entry — with the fixed R-multiple ladder only as a
 * fallback when structure runs out.
 */
function scanTargets(
  entry: number,
  stop: number,
  direction: "LONG" | "SHORT",
  levels: number[],
  atr: number | null,
  minRr: number,
): number[] {
  return structuralTargets({
    entry,
    stop,
    direction,
    levels,
    atr,
    minRr,
    fallbackMultiples: [2, 3, 4],
  }).map((v) => Number(v.toFixed(6)));
}


type FetchedCandles = {
  candles: Record<Timeframe, Candle[]>;
  rejects: Array<{ timeframe: Timeframe; rejects: CandleReject[] }>;
};

/**
 * Fetches every required timeframe and pushes it through the single
 * normaliser. Malformed candles are dropped and reported, never repaired.
 *
 * Timeframes are fetched two at a time: firing all five at once caused
 * provider read timeouts, while a fully sequential fetch made a whole scan
 * overrun its worker invocation so runs never finished.
 *
 * Higher timeframes are additionally cached in-process: H4 and D1 cannot
 * change between minute-by-minute scans, and re-reading them every minute was
 * the main source of provider read timeouts on a single resource slot. The
 * cache only ever serves candles that are still inside their own timeframe
 * interval, so no stale bar can reach a gate.
 */
const FETCH_CONCURRENCY = 2;

/** How long a fetched series may be reused, per timeframe. */
const CANDLE_CACHE_TTL_MS: Partial<Record<Timeframe, number>> = {
  "4h": 10 * 60_000,
  "1d": 30 * 60_000,
};

const candleCache = new Map<string, { at: number; candles: Candle[] }>();

function cachedCandles(symbol: string, tf: Timeframe): Candle[] | null {
  const ttl = CANDLE_CACHE_TTL_MS[tf];
  if (!ttl) return null;
  const hit = candleCache.get(`${symbol}:${tf}`);
  if (!hit || Date.now() - hit.at > ttl) return null;
  return hit.candles;
}

function rememberCandles(symbol: string, tf: Timeframe, candles: Candle[]): void {
  if (!CANDLE_CACHE_TTL_MS[tf] || candles.length === 0) return;
  candleCache.set(`${symbol}:${tf}`, { at: Date.now(), candles });
}

async function fetchTimeframes(symbol: string): Promise<FetchedCandles> {
  const rejects: FetchedCandles["rejects"] = [];
  const entries: Array<readonly [Timeframe, Candle[]]> = [];

  const pending: Timeframe[] = [];
  for (const tf of REQUIRED) {
    const cached = cachedCandles(symbol, tf);
    if (cached) entries.push([tf, cached] as const);
    else pending.push(tf);
  }

  for (let i = 0; i < pending.length; i += FETCH_CONCURRENCY) {
    const batch = pending.slice(i, i + FETCH_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async (tf) => {
        const raw = await marketData().getCandles(symbol, tf, tf === "1d" ? 120 : 200);
        return [tf, normaliseCandles(raw, tf)] as const;
      }),
    );
    for (const [tf, normalised] of fetched) {
      const malformed = normalised.rejected.filter((r) => r.reason !== "NOT_CLOSED");
      if (malformed.length) rejects.push({ timeframe: tf, rejects: malformed });
      rememberCandles(symbol, tf, normalised.candles);
      entries.push([tf, normalised.candles] as const);
    }
  }
  return {
    candles: Object.fromEntries(entries) as Record<Timeframe, Candle[]>,
    rejects,
  };
}


type Evaluation = {
  candidate: Candidate | null;
  gates: GateResult[];
  macroContext: Record<string, unknown>;
};

/** Evaluates a single instrument and returns its candidate plus every gate result. */
async function evaluateInstrument(
  admin: Admin,
  instrument: InstrumentRow,
  rulebook: Rulebook,
  macroEvents: MacroEvent[],
  runId: string | null,
): Promise<Evaluation> {
  const gates: GateResult[] = [];
  const now = new Date();

  // Session gate first: outside its allowed sessions an instrument is not
  // scanned for entries at all.
  const session = sessionAt(now);
  const allowedSessions =
    instrument.sessions && instrument.sessions.length > 0
      ? instrument.sessions
      : rulebook.allowed_sessions;
  gates.push(sessionGate(session, allowedSessions));

  // Symbol mapping: canonical name -> broker symbol.
  const resolved = await resolveSymbol(instrument);
  const symbol = resolved.broker;

  let candles: Record<Timeframe, Candle[]>;
  try {
    const fetched = await fetchTimeframes(symbol);
    candles = fetched.candles;
    for (const entry of fetched.rejects) {
      await recordScannerError(admin, {
        runId,
        instrument: instrument.symbol,
        stage: "NORMALISATION",
        error: new AppError(
          "VALIDATION",
          `${entry.rejects.length} malformed candle(s) dropped on ${TIMEFRAME_LABEL[entry.timeframe]}`,
        ),
        detail: { broker_symbol: symbol, rejects: entry.rejects.slice(0, 20) },
      });
    }
  } catch (error) {
    await recordScannerError(admin, {
      runId,
      instrument: instrument.symbol,
      stage: "MARKET_DATA",
      error,
      detail: { broker_symbol: symbol },
    });
    gates.push(
      missingData(false, {
        error: error instanceof Error ? error.message : "fetch failed",
        broker_symbol: symbol,
      }),
    );
    return { candidate: null, gates, macroContext: {} };
  }

  const haveAll = REQUIRED.every((tf) => candles[tf].length >= rulebook.atr_period + 2);
  gates.push(
    missingData(haveAll, {
      broker_symbol: symbol,
      resolved_from: resolved.resolvedFrom,
      ...Object.fromEntries(REQUIRED.map((tf) => [TIMEFRAME_LABEL[tf], candles[tf].length])),
    }),
  );
  if (!haveAll) return { candidate: null, gates, macroContext: {} };

  const entryCandles = candles[ENTRY_TF];
  const last = lastClosed(entryCandles)!;
  await cacheCandle(admin, instrument.symbol, TIMEFRAME_LABEL[ENTRY_TF], last);

  const sanity = checkCandleSanity(
    entryCandles,
    ENTRY_TF,
    60,
    candleGapMultipleFor(rulebook, instrument.symbol),
  );

  gates.push(candleSanity(sanity.ok, sanity.problems));

  // The freshness budget is measured from the close of the last closed entry
  // candle, which by definition ages a full timeframe interval before the next
  // one closes. Without that allowance a 300s budget on M15 rejects two thirds
  // of all minute-by-minute scans as STALE_DATA even on a perfectly live feed.
  const feedBudget = instrument.max_data_age_seconds ?? rulebook.max_data_age_seconds;
  const maxAge = feedBudget + TIMEFRAME_SECONDS[ENTRY_TF];
  gates.push(staleData(dataAgeSeconds(entryCandles, ENTRY_TF), maxAge));

  // Macro lockout scoped to the currencies this instrument actually trades.
  const currencies = currenciesFor(
    instrument.symbol,
    instrument.base_currency,
    instrument.quote_currency,
  );
  const macro = macroContextFor(
    macroEvents,
    instrument.symbol,
    currencies,
    now.getTime(),
    rulebook.macro_lookahead_minutes,
  );
  gates.push(newsLockout(macro.locked, macro.events.map((e) => e.title)));

  const atrValue = atr(entryCandles, rulebook.atr_period, rulebook.atr_method);
  const { bias, d1 } = higherTimeframeBias(candles["4h"], candles["1d"], rulebook.swing_lookback);

  const setup = detectSetup({
    candles: entryCandles,
    atr: atrValue,
    bias: bias as Bias,
    swingLookback: rulebook.swing_lookback,
    displacementMinAtr: rulebook.displacement_min_atr,
  });
  gates.push(noSetup(setup.found, setup.setupType, setup.detail));

  const direction: "LONG" | "SHORT" =
    setup.direction ?? (bias === "SHORT" ? "SHORT" : "LONG");

  gates.push({
    code: "NO_SWEEP",
    passed: setup.sweepFound || setup.setupType !== "SWEEP_DISPLACEMENT_RETEST",
    reason: setup.sweepFound
      ? `Liquidity swept at ${setup.level} and reclaimed.`
      : setup.setupType === "SWEEP_DISPLACEMENT_RETEST"
        ? "No liquidity sweep of a prior swing on the entry timeframe."
        : `${setup.setupType} does not require a liquidity sweep.`,
    detail: { level: setup.level, ...setup.detail },
  });
  gates.push({
    code: "NO_DISPLACEMENT",
    passed:
      setup.displacementAtr !== null && setup.displacementAtr >= rulebook.displacement_min_atr,
    reason:
      setup.displacementAtr !== null
        ? `Displacement candle of ${setup.displacementAtr.toFixed(2)} ATR in the ${direction} direction.`
        : "No displacement candle of sufficient size.",
    detail: { bodyAtr: setup.displacementAtr, minAtr: rulebook.displacement_min_atr },
  });
  gates.push({
    code: "NO_RETEST",
    passed: setup.retestFound,
    reason: setup.retestFound
      ? `Broken level ${setup.level} retested and held.`
      : "The broken level has not been retested and held on a closed candle.",
    detail: { level: setup.level, ...setup.detail },
  });

  const entryLow = roundToDigits(setup.entryLow, resolved.digits);
  const entryHigh = roundToDigits(setup.entryHigh, resolved.digits);
  const entry = entryLow !== null && entryHigh !== null ? (entryLow + entryHigh) / 2 : null;
  const stop = roundToDigits(
    setup.extreme !== null && atrValue
      ? direction === "LONG"
        ? setup.extreme - atrValue * 0.2
        : setup.extreme + atrValue * 0.2
      : null,
    resolved.digits,
  );

  gates.push(biasConflict(bias as Bias, direction));
  gates.push(invalidStop(entry, stop, direction, atrValue, rulebook.max_stop_atr_multiple));

  let spread: number | null = null;
  try {
    spread = await marketData().getSpread(symbol);
  } catch {
    spread = null;
  }
  gates.push(
    spreadGate(spread, atrValue, rulebook.max_spread_atr_ratio, instrument.max_spread ?? null),
  );

  // Opposing liquidity ahead of the entry: prior swing highs for a long, prior
  // swing lows for a short. These are the destinations the setup is actually
  // trading towards, so they define the target ladder.
  const opposingLevels = (
    direction === "LONG"
      ? swingHighs(entryCandles, rulebook.swing_lookback)
      : swingLows(entryCandles, rulebook.swing_lookback)
  ).map((s) => s.price);

  const targets =
    entry !== null && stop !== null
      ? scanTargets(
          entry,
          stop,
          direction,
          opposingLevels,
          atrValue,
          minTierRr(rulebook),
        ).map((t) => roundToDigits(t, resolved.digits) as number)
      : [];
  const rrRaw = targets.length > 0 ? rewardToRisk(entry, stop, targets[0]) : null;
  // Stored to two decimals so a displayed R:R always matches the stored one.
  const rr = rrRaw === null ? null : Number(rrRaw.toFixed(2));
  // Per-instrument minimums raise the top tiers only; the hard RR gate uses the
  // lowest tier floor, and the tier a candidate earns is decided after scoring.
  const topTierRr = Math.max(instrument.min_rr, rulebook.tier_min_rr.A);
  const tierRulebook: Rulebook = {
    ...rulebook,
    tier_min_rr: { ...rulebook.tier_min_rr, A_PLUS: topTierRr, A: topTierRr },
  };
  gates.push(rrGate(rr, minTierRr(tierRulebook)));

  const late = checkLateEntry(
    last.close,
    entryLow,
    entryHigh,
    atrValue,
    rulebook.late_entry_max_atr_from_entry,
  );
  gates.push(lateEntry(late.late, late.distanceAtr));

  // Expiry: a setup confirmed too long ago is no longer tradable.
  const triggerTime =
    (setup.detail.retestAt as string | undefined) ?? last.time ?? null;
  gates.push(expiry(triggerTime, rulebook.signal_expiry_minutes, now.getTime()));

  const print = fingerprint({
    instrument: instrument.symbol,
    direction,
    setupType: setup.setupType,
    timeframe: TIMEFRAME_LABEL[ENTRY_TF],
    tradingDayUtc: tradingDayUtc(),
    entry,
    stop,
    atr: atrValue,
  });
  gates.push(duplicate(await fingerprintExistsToday(admin, print), print));

  const spreadRatio = spread !== null && atrValue ? spread / atrValue : null;
  const { score, components } = scoreCandidate(
    {
      rr,
      biasAligned: bias === direction,
      d1Aligned: d1 === direction,
      displacementAtr: setup.displacementAtr,
      sweepFound: setup.sweepFound || setup.structureType !== null,
      retestFound: setup.retestFound,
      spreadRatio,
      lateDistanceAtr: late.distanceAtr,
      macroAligned: macro.aligned,
    },
    tierRulebook,
  );

  // Tier requires both the score band and that tier's reward-to-risk floor.
  const tier = tierFor(score, rr, tierRulebook);
  const bucket = tier ? tierBucket(tier) : "A";
  // A non-positive tier allowance means unlimited: the cap gate always passes.
  const bucketMax = rulebook.tier_daily_max[bucket] ?? rulebook.max_daily_actionable;
  if (!isUnlimitedCap(bucketMax)) {
    gates.push(dailyCap(await actionableCountToday(admin, bucket), bucketMax));
  }


  const failed = failedGates(gates);
  const qualified = failed.length === 0 && tier !== null;
  // A setup that failed a hard gate is never labelled with a tradable tier.
  const grade = qualified ? tier : null;

  const candidate: Candidate = {
    instrument: instrument.symbol,
    broker_symbol: symbol,
    timeframe: TIMEFRAME_LABEL[ENTRY_TF],
    direction,
    setup_type: setup.setupType,
    bias: bias as Bias,
    entry_zone_low: entryLow,
    entry_zone_high: entryHigh,
    stop_loss: stop,
    targets,
    rr_tp1: rr === null ? null : Number(rr.toFixed(3)),
    atr: atrValue,
    spread,
    score,
    grade,
    score_components: components,
    gate_results: gates,
    reasons: gates.filter((g) => g.passed).map((g) => g.reason),
    qualified,
    fingerprint: print,
    candle_time_utc: last.time,
  };

  return {
    candidate,
    gates,
    macroContext: {
      session,
      currencies,
      locked: macro.locked,
      events: macro.events,
      upcoming: macro.upcoming,
    },
  };
}

/** One full scan across every enabled instrument. */
export async function runScan(admin: Admin): Promise<ScanSummary> {
  const { data: settings } = await admin
    .from("scanner_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  const shadowMode = settings?.shadow_mode ?? true;

  const empty = (message: string, ok = true): ScanSummary => ({
    ok,
    shadowMode,
    scanned: [],
    candidates: 0,
    qualified: 0,
    actionable: 0,
    rejections: 0,
    message,
  });

  if (settings && settings.scanning_enabled === false) {
    await writeHeartbeat(admin, {
      status: "IDLE",
      metaapiConnected: null,
      rulebookVersion: settings.rulebook_version ?? null,
      detail: { reason: "Scanning disabled in scanner settings." },
    });
    return empty("Scanning disabled");
  }

  if (!marketData().isConfigured()) {
    await writeHeartbeat(admin, {
      status: "ERROR",
      metaapiConnected: false,
      rulebookVersion: settings?.rulebook_version ?? null,
      detail: { reason: "MetaApi is not configured." },
    });
    return { ...empty("MetaApi is not configured"), ok: false };
  }

  // Overlap protection: a slow run must never race the next scheduled tick.
  const locked = await acquireScanLock(admin, {
    ttlSeconds: 180,
    holder: new Date().toISOString(),
  });
  if (!locked) {
    return empty("A scan is already running");
  }

  try {
    return await runScanLocked(admin, shadowMode);
  } finally {
    await releaseScanLock(admin);
  }
}

async function runScanLocked(admin: Admin, shadowMode: boolean): Promise<ScanSummary> {
  const { data: rulebookRow } = await admin
    .from("rulebook_versions")
    .select("version, rules")
    .eq("is_active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rulebook = parseRulebook(rulebookRow);
  // Governance: every row this run writes carries the checksum of the exact
  // rules it was evaluated against.
  const checksum = await rulebookChecksum(rulebookRow?.rules ?? rulebook);

  const { data: instruments } = await admin
    .from("instruments")
    .select(
      "symbol, broker_symbol, aliases, digits, point_size, contract_size, base_currency, quote_currency, sessions, min_rr, max_spread, max_data_age_seconds",
    )
    .eq("enabled", true)
    .order("sort_order");

  // Close any run a killed worker left open before starting a new one.
  await closeStaleRuns(admin);

  const rows = (instruments ?? []) as InstrumentRow[];
  const symbols = rows.map((i) => i.symbol);
  const runId = await startRun(admin, symbols, rulebook.version, checksum);
  const macroEvents = await loadMacroEvents(admin);

  let candidates = 0;
  let qualifiedCount = 0;
  let actionable = 0;
  let rejectionCount = 0;
  const runRejections: Array<{ instrument: string; gate: string; reason: string }> = [];
  let metaapiConnected = true;
  let errorMessage: string | null = null;

  for (const instrument of rows) {
    try {
      const result = await evaluateInstrument(admin, instrument, rulebook, macroEvents, runId);
      const failed = failedGates(result.gates);
      rejectionCount += failed.length;
      for (const f of failed) {
        runRejections.push({ instrument: instrument.symbol, gate: f.code, reason: f.reason });
      }

      if (!result.candidate) {
        await saveRejections(admin, failed, {
          candidateId: null,
          runId,
          instrument: instrument.symbol,
          timeframe: TIMEFRAME_LABEL[ENTRY_TF],
        });
        continue;
      }

      candidates += 1;
      const candidateId = await saveCandidate(admin, result.candidate, {
        runId,
        rulebookVersion: rulebook.version,
        rulebookChecksum: checksum,
        shadowMode,
      });
      await saveRejections(admin, failed, {
        candidateId,
        runId,
        instrument: instrument.symbol,
        timeframe: result.candidate.timeframe,
      });

      if (!result.candidate.qualified) continue;
      qualifiedCount += 1;

      // Shadow mode never issues an actionable alert and never consumes a slot.
      if (shadowMode) {
        await promoteToSignal(admin, result.candidate, {
          candidateId,
          runId,
          rulebookVersion: rulebook.version,
          rulebookChecksum: checksum,
          shadowMode,
          macroContext: result.macroContext,
        });
        continue;
      }

      // Live mode: claim a slot atomically BEFORE promoting, so concurrent work
      // can never exceed that tier's daily cap.
      const tier = (result.candidate.grade ?? "C") as Tier;
      const bucket = tierBucket(tier);
      const claimed = await claimActionableSlot(
        admin,
        rulebook.tier_daily_max[bucket] ?? rulebook.max_daily_actionable,
        bucket,
      );

      if (!claimed) {
        runRejections.push({
          instrument: instrument.symbol,
          gate: "DAILY_CAP",
          reason: "Daily actionable cap already claimed.",
        });
        continue;
      }

      const signalId = await promoteToSignal(admin, result.candidate, {
        candidateId,
        runId,
        rulebookVersion: rulebook.version,
        rulebookChecksum: checksum,
        shadowMode,
        macroContext: result.macroContext,
      });

      if (signalId) {
        actionable += 1;
        await notifyQualifiedSignal(admin, {
          shadowMode,
          signalId,
          instrument: result.candidate.instrument,
          direction: result.candidate.direction,
          grade: result.candidate.grade,
          setupType: result.candidate.setup_type,
          timeframe: result.candidate.timeframe,
          entryZoneLow: result.candidate.entry_zone_low,
          entryZoneHigh: result.candidate.entry_zone_high,
          stopLoss: result.candidate.stop_loss,
          targets: result.candidate.targets,
          rr: result.candidate.rr_tp1,
          score: result.candidate.score,
          reasons: result.candidate.reasons,
        });
      }
    } catch (error) {
      metaapiConnected = false;
      errorMessage = error instanceof Error ? error.message : "scan failed";
      await recordScannerError(admin, {
        runId,
        instrument: instrument.symbol,
        stage: "EVALUATION",
        error,
      });
      console.error(`scan failed for ${instrument.symbol}`, errorMessage);
    }
  }

  await finishRun(admin, runId, {
    status: errorMessage ? "PARTIAL" : "SUCCESS",
    signals_emitted: qualifiedCount,
    rejections: runRejections,
    error_message: errorMessage,
  });

  // Non-sensitive account context so Scanner Health can show which broker feed
  // the scan read from. Never includes tokens, passwords or balances.
  const accountInfo = await marketData().getAccount().catch(() => null);

  await writeHeartbeat(admin, {
    status: errorMessage ? "DEGRADED" : "OK",
    metaapiConnected,
    rulebookVersion: rulebook.version,
    detail: {
      shadow_mode: shadowMode,
      rulebook_checksum: checksum,
      session: sessionAt(new Date()),
      instruments: symbols,
      candidates,
      qualified: qualifiedCount,
      rejections: rejectionCount,
      macro_events: macroEvents.length,
      account: accountInfo
        ? {
            login: accountInfo.login ?? null,
            server: accountInfo.server ?? null,
            region: accountInfo.region,
            state: accountInfo.state ?? null,
            connection_status: accountInfo.connectionStatus ?? null,
            reliability: accountInfo.reliability ?? null,
            account_id_mismatch: accountInfo.accountIdMismatch ?? false,
          }
        : null,
    },
  });

  return {
    ok: true,
    shadowMode,
    scanned: symbols,
    candidates,
    qualified: qualifiedCount,
    actionable,
    rejections: rejectionCount,
    message: errorMessage ?? undefined,
  };
}
