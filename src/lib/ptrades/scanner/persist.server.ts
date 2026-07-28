import type { Candidate, GateResult } from "./types";

/**
 * Persistence for the scanner. Every candidate and every rejection is stored,
 * whether it qualified or not. All writes are service-role, server-side only.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export function tradingDayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function startRun(
  admin: Admin,
  symbols: string[],
  rulebookVersion: string,
  rulebookChecksum: string | null = null,
): Promise<string | null> {
  const { data, error } = await admin
    .from("scanner_runs")
    .insert({
      status: "RUNNING",
      symbols_scanned: symbols,
      rulebook_version: rulebookVersion,
      rulebook_checksum: rulebookChecksum,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("scanner run insert failed", error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function finishRun(
  admin: Admin,
  runId: string | null,
  patch: {
    status: string;
    signals_emitted: number;
    rejections: unknown;
    error_message?: string | null;
  },
) {
  if (!runId) return;
  const { error } = await admin
    .from("scanner_runs")
    .update({
      finished_at: new Date().toISOString(),
      status: patch.status,
      signals_emitted: patch.signals_emitted,
      rejections: patch.rejections as never,
      error_message: patch.error_message ?? null,
    })
    .eq("id", runId);
  if (error) console.error("scanner run update failed", error.message);
}

export async function saveCandidate(
  admin: Admin,
  candidate: Candidate,
  meta: {
    runId: string | null;
    rulebookVersion: string;
    rulebookChecksum?: string | null;
    shadowMode: boolean;
  },
): Promise<string | null> {
  const { data, error } = await admin
    .from("signal_candidates")
    .insert({
      scanner_run_id: meta.runId,
      instrument: candidate.instrument,
      broker_symbol: candidate.broker_symbol,
      timeframe: candidate.timeframe,
      direction: candidate.direction,
      setup_type: candidate.setup_type,
      bias: candidate.bias,
      entry_zone_low: candidate.entry_zone_low,
      entry_zone_high: candidate.entry_zone_high,
      stop_loss: candidate.stop_loss,
      targets: candidate.targets as never,
      rr_tp1: candidate.rr_tp1,
      atr: candidate.atr,
      spread: candidate.spread,
      score: candidate.score,
      grade: candidate.grade,
      score_components: candidate.score_components as never,
      gate_results: candidate.gate_results as never,
      reasons: candidate.reasons as never,
      qualified: candidate.qualified,
      fingerprint: candidate.fingerprint,
      shadow_mode: meta.shadowMode,
      rulebook_version: meta.rulebookVersion,
      candle_time_utc: candidate.candle_time_utc,
      trading_day_utc: tradingDayUtc(),
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("candidate insert failed", error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Gates that re-fire identically on every minute-by-minute scan for the same
 * fingerprint. They stay in the in-memory run summary but are not written to
 * `signal_rejections`, where they would otherwise bury the diagnostic signal.
 */
const NOISY_GATES = new Set(["DUPLICATE"]);

export async function saveRejections(
  admin: Admin,
  rows: GateResult[],
  meta: { candidateId: string | null; runId: string | null; instrument: string; timeframe: string },
) {
  const persistable = rows.filter((r) => !NOISY_GATES.has(r.code));
  if (persistable.length === 0) return;
  const { error } = await admin.from("signal_rejections").insert(
    persistable.map((r) => ({
      candidate_id: meta.candidateId,
      scanner_run_id: meta.runId,
      instrument: meta.instrument,
      timeframe: meta.timeframe,
      gate_code: r.code,
      reason: r.reason,
      detail: (r.detail ?? {}) as never,
      trading_day_utc: tradingDayUtc(),
    })),
  );
  if (error) console.error("rejection insert failed", error.message);
}

export async function promoteToSignal(
  admin: Admin,
  candidate: Candidate,
  meta: {
    candidateId: string | null;
    runId: string | null;
    rulebookVersion: string;
    shadowMode: boolean;
    macroContext?: Record<string, unknown>;
  },
): Promise<string | null> {
  const entry =
    candidate.entry_zone_low !== null && candidate.entry_zone_high !== null
      ? (candidate.entry_zone_low + candidate.entry_zone_high) / 2
      : null;

  const { data, error } = await admin
    .from("signals")
    .upsert(
      {
        external_id: candidate.fingerprint,
        candidate_id: meta.candidateId,
        fingerprint: candidate.fingerprint,
        instrument: candidate.instrument,
        broker_symbol: candidate.broker_symbol,
        direction: candidate.direction,
        setup_type: candidate.setup_type,
        timeframe: candidate.timeframe,
        entry_zone_low: candidate.entry_zone_low,
        entry_zone_high: candidate.entry_zone_high,
        stop_loss: candidate.stop_loss,
        targets: candidate.targets as never,
        rr_tp1: candidate.rr_tp1,
        score: candidate.score,
        grade: candidate.grade,
        score_components: candidate.score_components as never,
        reasons: candidate.reasons as never,
        rejection_reasons: [] as never,
        macro_context: (meta.macroContext ?? {}) as never,
        spread: candidate.spread,
        // Shadow mode can never emit an actionable alert.
        is_actionable: meta.shadowMode ? false : true,
        shadow_mode: meta.shadowMode,
        status: "ACTIVE",
        rulebook_version: meta.rulebookVersion,
        scanner_run_id: meta.runId,
        signal_time_utc: new Date().toISOString(),
        trading_day_utc: tradingDayUtc(),
      },
      { onConflict: "external_id", ignoreDuplicates: false },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("signal upsert failed", error.message, { entry });
    return null;
  }
  if (data?.id && meta.candidateId) {
    await admin
      .from("signal_candidates")
      .update({ promoted_signal_id: data.id })
      .eq("id", meta.candidateId);
  }
  return data?.id ?? null;
}

export async function actionableCountToday(admin: Admin, bucket?: string): Promise<number> {
  let query = admin
    .from("daily_alert_counters")
    .select("actionable_count")
    .eq("trading_day_utc", tradingDayUtc());
  if (bucket) query = query.eq("tier", bucket);
  const { data } = await query;
  return (data ?? []).reduce((sum, row) => sum + (row.actionable_count ?? 0), 0);
}

/**
 * Closes runs a previous worker abandoned. A worker that is killed mid-scan
 * never writes `finished_at`, so without this the run list fills with rows
 * stuck in RUNNING and the health screen cannot tell a live run from a dead
 * one.
 */
export async function closeStaleRuns(admin: Admin, olderThanSeconds = 600): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
  const { data, error } = await admin
    .from("scanner_runs")
    .update({
      status: "TIMEOUT",
      finished_at: new Date().toISOString(),
      error_message: "Run did not finish within the scan lock TTL.",
    })
    .eq("status", "RUNNING")
    .lt("started_at", cutoff)
    .select("id");
  if (error) {
    console.error("stale run cleanup failed", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

export async function incrementActionableCount(admin: Admin, max: number, bucket = "A") {
  const day = tradingDayUtc();
  const current = await actionableCountToday(admin, bucket);
  const { error } = await admin
    .from("daily_alert_counters")
    .upsert(
      { trading_day_utc: day, tier: bucket, actionable_count: current + 1, max_allowed: max },
      { onConflict: "trading_day_utc,tier" },
    );
  if (error) console.error("daily counter update failed", error.message);
}

export async function cacheCandle(
  admin: Admin,
  instrument: string,
  timeframe: string,
  candle: { time: string; open: number; high: number; low: number; close: number; volume: number | null },
) {
  const { error } = await admin.from("candles_cache").upsert(
    {
      instrument,
      timeframe,
      candle_time_utc: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "instrument,timeframe" },
  );
  if (error) console.error("candle cache upsert failed", error.message);
}

/**
 * Duplicate detection is scoped to signals that were actually PROMOTED today,
 * not to every candidate evaluated today. A candidate row is written on every
 * minute-by-minute scan, so scoping to candidates meant a setup that missed a
 * gate on the minute it first appeared could never alert for the rest of the
 * day — which is why no alert had ever been issued.
 */
export async function fingerprintExistsToday(
  admin: Admin,
  fingerprint: string | null,
): Promise<boolean> {
  if (!fingerprint) return false;
  const { data } = await admin
    .from("signals")
    .select("id")
    .eq("fingerprint", fingerprint)
    .eq("trading_day_utc", tradingDayUtc())
    .limit(1);
  return Boolean(data && data.length > 0);
}

/**
 * Atomically claims one of the day's limited actionable slots. Returns false
 * when the cap is already used, so two concurrent runs can never both alert.
 */
export async function claimActionableSlot(
  admin: Admin,
  max: number,
  bucket = "A",
): Promise<boolean> {
  const { data, error } = await admin.rpc("claim_actionable_slot", {
    _day: tradingDayUtc(),
    _max: max,
    _tier: bucket,
  });
  if (error) {
    console.error("claim_actionable_slot failed", error.message);
    return false; // Fail closed.
  }
  return data === true;
}
