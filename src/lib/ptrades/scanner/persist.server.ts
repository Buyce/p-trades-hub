import type { Database } from "@/integrations/supabase/types";
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
      rulebook_checksum: meta.rulebookChecksum ?? null,
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

export type PrecisionPromotion = {
  preferredEntry: number | null;
  zoneWidthPoints: number | null;
  invalidation: string | null;
  invalidationPrice: number | null;
  invalidationTimeframe: string | null;
  lifecycleState: string;
  armedAt: string | null;
};

export async function promoteToSignal(
  admin: Admin,
  candidate: Candidate,
  meta: {
    candidateId: string | null;
    runId: string | null;
    rulebookVersion: string;
    rulebookChecksum?: string | null;
    shadowMode: boolean;
    macroContext?: Record<string, unknown>;
    /**
     * Present when the precision engine owns execution timing. The signal is
     * stored ARMED and NOT actionable; only the precision loop may promote it
     * to ENTRY_READY and make it alertable.
     */
    precision?: PrecisionPromotion;
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
        // Shadow mode can never emit an actionable alert, and neither can a
        // setup the precision engine has merely armed.
        is_actionable: meta.shadowMode || meta.precision ? false : true,
        shadow_mode: meta.shadowMode,
        status: "ACTIVE",
        lifecycle_state: meta.precision?.lifecycleState ?? "DETECTED",
        armed_at: meta.precision?.armedAt ?? null,
        preferred_entry: meta.precision?.preferredEntry ?? null,
        zone_width_points: meta.precision?.zoneWidthPoints ?? null,
        invalidation: meta.precision?.invalidation ?? null,
        invalidation_price: meta.precision?.invalidationPrice ?? null,
        invalidation_timeframe: meta.precision?.invalidationTimeframe ?? null,
        rulebook_version: meta.rulebookVersion,
        rulebook_checksum: meta.rulebookChecksum ?? null,
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

/* ------------------------------------------------------------------ *
 * Precision watches — the durable record of a setup that is armed and *
 * waiting for its execution moment. One open watch per signal.        *
 * ------------------------------------------------------------------ */

export type PrecisionWatchRow =
  Database["public"]["Tables"]["precision_watches"]["Row"];

export async function openPrecisionWatch(
  admin: Admin,
  watch: Database["public"]["Tables"]["precision_watches"]["Insert"],
): Promise<string | null> {
  const { data, error } = await admin
    .from("precision_watches")
    .upsert(watch, { onConflict: "signal_id", ignoreDuplicates: false })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("precision watch insert failed", error.message);
    return null;
  }
  return data?.id ?? null;
}

/** Every watch still capable of reaching ENTRY_READY. */
export async function listOpenWatches(admin: Admin): Promise<PrecisionWatchRow[]> {
  const { data, error } = await admin
    .from("precision_watches")
    .select("*")
    .in("state", ["ARMED", "MICRO_TRIGGERED"])
    .order("armed_at", { ascending: true });
  if (error) {
    console.error("precision watch read failed", error.message);
    return [];
  }
  return (data ?? []) as PrecisionWatchRow[];
}

export async function updateWatch(
  admin: Admin,
  id: string,
  patch: Database["public"]["Tables"]["precision_watches"]["Update"],
): Promise<void> {
  const { error } = await admin.from("precision_watches").update(patch).eq("id", id);
  if (error) console.error("precision watch update failed", error.message);
}

/**
 * Records a terminal outcome. Terminal watches are kept for calibration, so the
 * diagnostic snapshot written by the last evaluation is preserved rather than
 * overwritten — an expiry with no record of how close it came is unusable.
 */
export async function resolveWatch(
  admin: Admin,
  id: string,
  state: "MISSED" | "EXPIRED" | "INVALIDATED",
  reason: string,
  previousMetadata?: unknown,
): Promise<void> {
  const prior =
    previousMetadata && typeof previousMetadata === "object"
      ? (previousMetadata as Record<string, unknown>)
      : {};
  await updateWatch(admin, id, {
    state,
    resolved_at: new Date().toISOString(),
    metadata: { ...prior, resolution: reason, resolved_state: state } as never,
  });
}


/** Mirrors a watch's terminal state onto its signal. */
export async function closeSignalLifecycle(
  admin: Admin,
  signalId: string,
  state: "MISSED" | "EXPIRED" | "INVALIDATED",
): Promise<void> {
  const { error } = await admin
    .from("signals")
    .update({
      lifecycle_state: state,
      status: state === "INVALIDATED" ? "INVALIDATED" : "EXPIRED",
    })
    .eq("id", signalId)
    .eq("is_actionable", false);
  if (error) console.error("signal lifecycle close failed", error.message);
}

/** Promotes an armed signal to a tradable, alertable ENTRY_READY signal. */
export async function markSignalEntryReady(
  admin: Admin,
  signalId: string,
  patch: {
    preferredEntry: number | null;
    entryLow: number | null;
    entryHigh: number | null;
    zoneWidthPoints: number | null;
    triggerSummary: string | null;
    triggerTimeframe: string | null;
    triggerCandleTime: string | null;
    triggerLevel: number | null;
    priceAtAlert: number | null;
    distanceToEntryPoints: number | null;
    rr: number | null;
    spread: number | null;
    reasons: string[];
    expiresAtUtc: string | null;
    /** The tier earned at arming time, kept for calibration. */
    provisionalScore: number | null;
    provisionalGrade: string | null;
    /** The tier actually earned at execution prices — the one users see. */
    finalScore: number | null;
    finalGrade: string | null;
    finalScoreComponents: Record<string, number>;
  },
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("signals")
    .update({
      lifecycle_state: "ENTRY_READY",
      is_actionable: true,
      entry_ready_at: now,
      signal_time_utc: now,
      preferred_entry: patch.preferredEntry,
      entry_zone_low: patch.entryLow,
      entry_zone_high: patch.entryHigh,
      zone_width_points: patch.zoneWidthPoints,
      trigger_summary: patch.triggerSummary,
      trigger_timeframe: patch.triggerTimeframe,
      trigger_candle_time: patch.triggerCandleTime,
      trigger_level: patch.triggerLevel,
      price_at_alert: patch.priceAtAlert,
      distance_to_entry_points: patch.distanceToEntryPoints,
      rr_tp1: patch.rr,
      spread: patch.spread,
      reasons: patch.reasons as never,
      expires_at_utc: patch.expiresAtUtc,
      provisional_score: patch.provisionalScore,
      provisional_grade: (patch.provisionalGrade ?? null) as never,
      final_score: patch.finalScore,
      final_grade: (patch.finalGrade ?? null) as never,
      final_score_components: patch.finalScoreComponents as never,
      score_calculated_at: now,
      // The displayed tier is the recalculated one, so a stored signal can
      // never show a tier the alert did not actually earn.
      score: patch.finalScore,
      grade: (patch.finalGrade ?? null) as never,
    })
    .eq("id", signalId)
    // Idempotency: a signal already made actionable is never alerted twice.
    .eq("is_actionable", false)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("entry-ready promotion failed", error.message);
    return false;
  }
  return Boolean(data?.id);
}
