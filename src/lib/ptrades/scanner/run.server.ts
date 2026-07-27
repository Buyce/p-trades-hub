import type { Bias, Candidate, Candle, GateResult, Rulebook, Timeframe } from "./types";
import { DEFAULT_RULEBOOK, TIMEFRAME_LABEL } from "./types";
import { getCandles, getCurrentSpread, isMetaApiConfigured } from "./metaapi.server";
import { closedCandlesOnly, dataAgeSeconds, lastClosed } from "./candles.server";
import { atr } from "./atr.server";
import { higherTimeframeBias } from "./bias.server";
import { detectSweep } from "./sweep.server";
import { detectDisplacement } from "./displacement.server";
import { detectRetest } from "./retest.server";
import { checkLateEntry } from "./late-entry.server";
import { fingerprint } from "./fingerprint.server";
import { scoreCandidate } from "./scoring.server";
import {
  biasConflict,
  dailyCap,
  duplicate,
  failedGates,
  invalidStop,
  lateEntry,
  missingData,
  newsLockout,
  rrGate,
  spreadGate,
  staleData,
} from "./gates.server";
import {
  actionableCountToday,
  cacheCandle,
  fingerprintExistsToday,
  finishRun,
  incrementActionableCount,
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

async function activeLockouts(admin: Admin): Promise<string[]> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("macro_events")
    .select("title, lockout_start_utc, lockout_end_utc")
    .lte("lockout_start_utc", nowIso)
    .gte("lockout_end_utc", nowIso);
  return (data ?? []).map((e) => e.title);
}

function targetsFrom(entry: number, stop: number, direction: "LONG" | "SHORT"): number[] {
  const risk = Math.abs(entry - stop);
  const sign = direction === "LONG" ? 1 : -1;
  return [entry + sign * risk * 2, entry + sign * risk * 3, entry + sign * risk * 4].map((v) =>
    Number(v.toFixed(6)),
  );
}

async function fetchTimeframes(symbol: string): Promise<Record<Timeframe, Candle[]>> {
  const entries = await Promise.all(
    REQUIRED.map(async (tf) => {
      const raw = await getCandles(symbol, tf, tf === "1d" ? 120 : 200);
      return [tf, closedCandlesOnly(raw, tf)] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<Timeframe, Candle[]>;
}

/** Evaluates a single instrument and returns its candidate plus every gate result. */
async function evaluateInstrument(
  admin: Admin,
  instrument: {
    symbol: string;
    broker_symbol: string | null;
    min_rr: number;
    max_spread: number | null;
  },
  rulebook: Rulebook,
  lockouts: string[],
  actionableToday: number,
): Promise<{ candidate: Candidate; gates: GateResult[] } | { gates: GateResult[]; candidate: null }> {
  const symbol = instrument.broker_symbol ?? instrument.symbol;
  const gates: GateResult[] = [];

  let candles: Record<Timeframe, Candle[]>;
  try {
    candles = await fetchTimeframes(symbol);
  } catch (error) {
    gates.push(
      missingData(false, { error: error instanceof Error ? error.message : "fetch failed" }),
    );
    return { candidate: null, gates };
  }

  const haveAll = REQUIRED.every((tf) => candles[tf].length >= rulebook.atr_period + 2);
  gates.push(
    missingData(
      haveAll,
      Object.fromEntries(REQUIRED.map((tf) => [TIMEFRAME_LABEL[tf], candles[tf].length])),
    ),
  );
  if (!haveAll) return { candidate: null, gates };

  const entryCandles = candles[ENTRY_TF];
  const last = lastClosed(entryCandles)!;
  await cacheCandle(admin, instrument.symbol, TIMEFRAME_LABEL[ENTRY_TF], last);

  gates.push(
    staleData(dataAgeSeconds(entryCandles, ENTRY_TF), rulebook.max_data_age_seconds),
  );
  gates.push(newsLockout(lockouts.length > 0, lockouts));

  const atrValue = atr(entryCandles, rulebook.atr_period);
  const { bias, d1 } = higherTimeframeBias(candles["4h"], candles["1d"], rulebook.swing_lookback);

  const sweep = detectSweep(entryCandles, rulebook.swing_lookback);
  gates.push({
    code: "NO_SWEEP",
    passed: sweep.found,
    reason: sweep.found
      ? `Liquidity swept at ${sweep.level} and reclaimed.`
      : "No liquidity sweep of a prior swing on the entry timeframe.",
    detail: { level: sweep.level, sweptAt: sweep.sweptAt },
  });

  const direction: "LONG" | "SHORT" = sweep.direction ?? (bias === "SHORT" ? "SHORT" : "LONG");

  const displacement = detectDisplacement(
    entryCandles,
    direction,
    atrValue,
    rulebook.displacement_min_atr,
  );
  gates.push({
    code: "NO_DISPLACEMENT",
    passed: displacement.found,
    reason: displacement.found
      ? `Displacement candle of ${displacement.bodyAtr?.toFixed(2)} ATR in the ${direction} direction.`
      : "No displacement candle of sufficient size.",
    detail: { bodyAtr: displacement.bodyAtr, at: displacement.at },
  });

  const retest = detectRetest(entryCandles, direction, sweep.level, atrValue);
  gates.push({
    code: "NO_RETEST",
    passed: retest.found,
    reason: retest.found
      ? `Broken level ${retest.level} retested and held.`
      : "The broken level has not been retested and held on a closed candle.",
    detail: { level: retest.level, at: retest.at },
  });

  const entryLow = retest.entryLow;
  const entryHigh = retest.entryHigh;
  const entry = entryLow !== null && entryHigh !== null ? (entryLow + entryHigh) / 2 : null;
  const stop =
    sweep.extreme !== null && atrValue
      ? direction === "LONG"
        ? sweep.extreme - atrValue * 0.2
        : sweep.extreme + atrValue * 0.2
      : null;

  gates.push(biasConflict(bias as Bias, direction));
  gates.push(invalidStop(entry, stop, direction, atrValue));

  let spread: number | null = null;
  try {
    spread = await getCurrentSpread(symbol);
  } catch {
    spread = null;
  }
  gates.push(
    spreadGate(spread, atrValue, rulebook.max_spread_atr_ratio, instrument.max_spread ?? null),
  );

  const targets = entry !== null && stop !== null ? targetsFrom(entry, stop, direction) : [];
  const risk = entry !== null && stop !== null ? Math.abs(entry - stop) : null;
  const rr =
    risk && risk > 0 && targets.length > 0 ? Math.abs(targets[0] - entry!) / risk : null;
  const minRr = Math.max(instrument.min_rr, rulebook.min_rr_tp1);
  gates.push(rrGate(rr, minRr));

  const late = checkLateEntry(
    last.close,
    entryLow,
    entryHigh,
    atrValue,
    rulebook.late_entry_max_atr_from_entry,
  );
  gates.push(lateEntry(late.late, late.distanceAtr));

  const print = fingerprint({
    instrument: instrument.symbol,
    direction,
    setupType: "SWEEP_DISPLACEMENT_RETEST",
    timeframe: TIMEFRAME_LABEL[ENTRY_TF],
    tradingDayUtc: tradingDayUtc(),
    entry,
    stop,
    atr: atrValue,
  });
  gates.push(duplicate(await fingerprintExistsToday(admin, print), print));
  gates.push(dailyCap(actionableToday, rulebook.max_daily_actionable));

  const spreadRatio = spread !== null && atrValue ? spread / atrValue : null;
  const { score, grade, components } = scoreCandidate(
    {
      rr,
      biasAligned: bias === direction,
      d1Aligned: d1 === direction,
      displacementAtr: displacement.bodyAtr,
      sweepFound: sweep.found,
      retestFound: retest.found,
      spreadRatio,
      lateDistanceAtr: late.distanceAtr,
    },
    rulebook,
  );

  const failed = failedGates(gates);
  const qualified = failed.length === 0 && (grade === "A_PLUS" || grade === "A");

  const candidate: Candidate = {
    instrument: instrument.symbol,
    broker_symbol: instrument.broker_symbol,
    timeframe: TIMEFRAME_LABEL[ENTRY_TF],
    direction,
    setup_type: "SWEEP_DISPLACEMENT_RETEST",
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

  return { candidate, gates };
}

/** One full scan across every enabled instrument. */
export async function runScan(admin: Admin): Promise<ScanSummary> {
  const { data: settings } = await admin
    .from("scanner_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  const shadowMode = settings?.shadow_mode ?? true;

  if (settings && settings.scanning_enabled === false) {
    await writeHeartbeat(admin, {
      status: "IDLE",
      metaapiConnected: null,
      rulebookVersion: settings.rulebook_version ?? null,
      detail: { reason: "Scanning disabled in scanner settings." },
    });
    return {
      ok: true,
      shadowMode,
      scanned: [],
      candidates: 0,
      qualified: 0,
      actionable: 0,
      rejections: 0,
      message: "Scanning disabled",
    };
  }

  if (!isMetaApiConfigured()) {
    await writeHeartbeat(admin, {
      status: "ERROR",
      metaapiConnected: false,
      rulebookVersion: settings?.rulebook_version ?? null,
      detail: { reason: "MetaApi is not configured." },
    });
    return {
      ok: false,
      shadowMode,
      scanned: [],
      candidates: 0,
      qualified: 0,
      actionable: 0,
      rejections: 0,
      message: "MetaApi is not configured",
    };
  }

  const { data: rulebookRow } = await admin
    .from("rulebook_versions")
    .select("version, rules")
    .eq("is_active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rulebook = parseRulebook(rulebookRow);

  const { data: instruments } = await admin
    .from("instruments")
    .select("symbol, broker_symbol, min_rr, max_spread")
    .eq("enabled", true)
    .order("sort_order");

  const symbols = (instruments ?? []).map((i) => i.symbol);
  const runId = await startRun(admin, symbols, rulebook.version);
  const lockouts = await activeLockouts(admin);

  let candidates = 0;
  let qualifiedCount = 0;
  let actionable = 0;
  let rejectionCount = 0;
  const runRejections: Array<{ instrument: string; gate: string; reason: string }> = [];
  let metaapiConnected = true;
  let errorMessage: string | null = null;

  for (const instrument of instruments ?? []) {
    let actionableToday = await actionableCountToday(admin);
    try {
      const result = await evaluateInstrument(
        admin,
        instrument,
        rulebook,
        lockouts,
        actionableToday,
      );
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

      const signalId = await promoteToSignal(admin, result.candidate, {
        candidateId,
        runId,
        rulebookVersion: rulebook.version,
        shadowMode,
      });

      if (signalId && !shadowMode) {
        await incrementActionableCount(admin, rulebook.max_daily_actionable);
        actionableToday += 1;
        actionable += 1;
        await notifyQualifiedSignal(admin, {
          shadowMode,
          signalId,
          instrument: result.candidate.instrument,
          direction: result.candidate.direction,
          grade: result.candidate.grade,
          rr: result.candidate.rr_tp1,
        });
      }
    } catch (error) {
      metaapiConnected = false;
      errorMessage = error instanceof Error ? error.message : "scan failed";
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
  const accountInfo = await getAccountInfo().catch(() => null);

  await writeHeartbeat(admin, {
    status: errorMessage ? "DEGRADED" : "OK",
    metaapiConnected,
    rulebookVersion: rulebook.version,
    detail: {
      shadow_mode: shadowMode,
      instruments: symbols,
      candidates,
      qualified: qualifiedCount,
      rejections: rejectionCount,
      lockouts,
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
