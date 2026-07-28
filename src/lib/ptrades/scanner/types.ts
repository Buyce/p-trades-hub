/**
 * Shared scanner types. Pure data shapes — no trading logic, no secrets.
 */

export type Timeframe = "M1" | "M5" | "M15" | "1h" | "4h" | "1d";

export const TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "1h", "4h", "1d"];

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  M1: "M1",
  M5: "M5",
  M15: "M15",
  "1h": "H1",
  "4h": "H4",
  "1d": "D1",
};

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

export type Candle = {
  time: string; // ISO, candle open time (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type CandleSet = Record<Timeframe, Candle[]>;

export type Bias = "LONG" | "SHORT" | "NEUTRAL";

export type Swing = { index: number; price: number; time: string };

export type GateCode =
  | "MISSING_DATA"
  | "NO_MICRO_TRIGGER"
  | "NO_MICRO_RETEST"
  | "NOT_NEAR_ENTRY"
  | "MISSING_INVALIDATION"
  | "TARGET_TOUCHED"
  | "STALE_DATA"
  | "SPREAD"
  | "NEWS_LOCKOUT"
  | "BIAS_CONFLICT"
  | "NO_SWEEP"
  | "NO_DISPLACEMENT"
  | "NO_RETEST"
  | "INVALID_STOP"
  | "RR_BELOW_MIN"
  | "LATE_ENTRY"
  | "DUPLICATE"
  | "TIER_NOT_MET"
  | "SESSION"
  | "CANDLE_SANITY"
  | "EXPIRED"
  | "NO_SETUP";

export type GateResult = {
  code: GateCode;
  passed: boolean;
  reason: string;
  detail?: Record<string, unknown>;
};

export type Rulebook = {
  version: string;
  closed_candles_only: boolean;
  min_rr_tp1: number;
  max_data_age_seconds: number;
  max_spread_atr_ratio: number;
  late_entry_max_atr_from_entry: number;
  atr_period: number;
  /** WILDER (tuned default, live behaviour) or SMA (Python reference spec). */
  atr_method: "WILDER" | "SMA";
  swing_lookback: number;
  displacement_min_atr: number;
  /**
   * Displacement required to ARM a watch (open a precision watch). Lower than
   * `displacement_min_atr`, which remains the final-quality threshold used by
   * scoring and the alert gates.
   */
  arming_displacement_min_atr?: number;
  /** Per-instrument override of `arming_displacement_min_atr`. */
  instrument_arming_displacement_min_atr?: Record<string, number>;
  allowed_sessions: string[];
  signal_expiry_minutes: number;
  max_candle_gap_multiple: number;
  /**
   * Per-instrument override of `max_candle_gap_multiple`. Instruments with a
   * daily trading break (gold, indices) legitimately show a multi-candle gap
   * that is not corrupt data.
   */
  instrument_max_candle_gap_multiple?: Record<string, number>;

  macro_lookahead_minutes: number;
  /** Widest stop the scanner accepts, as a multiple of ATR. */
  max_stop_atr_multiple: number;
  grades: { A_PLUS: number; A: number; B: number; C: number };
  /** Minimum reward-to-risk at TP1 per tier. Only C relaxes the RR floor. */
  tier_min_rr: { A_PLUS: number; A: number; B: number; C: number };
  /** Precision entry engine settings. See `PrecisionRules`. */
  precision: PrecisionRules;
};

/**
 * Lifecycle of a setup, from detection through to a tradable execution moment.
 * Only ENTRY_READY may ever produce an alert.
 */
export type SetupLifecycleState =
  | "DETECTED"
  | "ARMED"
  | "MICRO_TRIGGERED"
  | "ENTRY_READY"
  | "MISSED"
  | "EXPIRED"
  | "INVALIDATED";

export const LIFECYCLE_STATES: SetupLifecycleState[] = [
  "DETECTED",
  "ARMED",
  "MICRO_TRIGGERED",
  "ENTRY_READY",
  "MISSED",
  "EXPIRED",
  "INVALIDATED",
];

/** Per-instrument execution parameters. All widths are in points. */
export type PrecisionInstrumentRules = {
  /** Narrowest acceptable execution zone, in points. */
  min: number;
  /** Widest acceptable execution zone, in points. */
  max: number;
  spreadMult: number;
  atrM1: number;
  atrM5: number;
  /** How far price may extend past the planned entry, as a fraction of risk. */
  maxExtensionR: number;
  /** How close the live quote must sit to the preferred entry, in points. */
  proximityPoints: number;
  /** How long a setup stays ARMED before it expires. */
  armedExpiryMinutes: number;
};

export type PrecisionRules = {
  enabled: boolean;
  /** Closed M1 candles allowed between the micro trigger and its retest. */
  trigger_expiry_bars: number;
  /** Reward-to-risk that must still be available at the preferred entry. */
  min_entry_ready_rr: number;
  default: PrecisionInstrumentRules;
  instruments: Record<string, PrecisionInstrumentRules>;
};

export const DEFAULT_PRECISION_INSTRUMENT: PrecisionInstrumentRules = {
  min: 4,
  max: 10,
  spreadMult: 2.0,
  atrM1: 0.05,
  atrM5: 0.02,
  maxExtensionR: 0.15,
  proximityPoints: 6,
  armedExpiryMinutes: 30,
};

export const DEFAULT_PRECISION: PrecisionRules = {
  enabled: true,
  trigger_expiry_bars: 3,
  min_entry_ready_rr: 2.0,
  default: DEFAULT_PRECISION_INSTRUMENT,
  instruments: {
    EURUSD: { ...DEFAULT_PRECISION_INSTRUMENT, min: 3, max: 8, proximityPoints: 5 },
    GBPUSD: { ...DEFAULT_PRECISION_INSTRUMENT },
    GBPAUD: {
      ...DEFAULT_PRECISION_INSTRUMENT,
      min: 6,
      max: 14,
      atrM1: 0.06,
      atrM5: 0.025,
      maxExtensionR: 0.18,
      proximityPoints: 8,
    },
    USDJPY: { ...DEFAULT_PRECISION_INSTRUMENT, min: 3, max: 8, proximityPoints: 5 },
    XAUUSD: {
      ...DEFAULT_PRECISION_INSTRUMENT,
      min: 20,
      max: 80,
      atrM1: 0.04,
      atrM5: 0.015,
      maxExtensionR: 0.12,
      proximityPoints: 30,
      armedExpiryMinutes: 20,
    },
    NAS100: {
      ...DEFAULT_PRECISION_INSTRUMENT,
      min: 20,
      max: 80,
      atrM1: 0.04,
      atrM5: 0.015,
      maxExtensionR: 0.12,
      proximityPoints: 30,
      armedExpiryMinutes: 20,
    },
  },
};

/** Execution parameters for one instrument, falling back to the defaults. */
export function precisionRulesFor(
  rulebook: Rulebook,
  symbol: string,
): PrecisionInstrumentRules {
  const precision = rulebook.precision ?? DEFAULT_PRECISION;
  const base = { ...DEFAULT_PRECISION_INSTRUMENT, ...(precision.default ?? {}) };
  return { ...base, ...(precision.instruments?.[symbol] ?? {}) };
}

export const DEFAULT_RULEBOOK: Rulebook = {
  version: "v2.1.0-live",
  closed_candles_only: true,
  min_rr_tp1: 2.0,
  max_data_age_seconds: 300,
  max_spread_atr_ratio: 0.15,
  late_entry_max_atr_from_entry: 1.5,
  atr_period: 14,
  atr_method: "WILDER",
  swing_lookback: 5,
  displacement_min_atr: 1.0,
  allowed_sessions: ["LONDON", "NEWYORK"],
  signal_expiry_minutes: 60,
  max_candle_gap_multiple: 6,
  macro_lookahead_minutes: 60,
  max_stop_atr_multiple: 4,
  grades: { A_PLUS: 95, A: 90, B: 80, C: 70 },
  tier_min_rr: { A_PLUS: 2.0, A: 2.0, B: 1.5, C: 1.2 },
  precision: DEFAULT_PRECISION,
};

/** Candle-gap tolerance for one instrument, honouring any rulebook override. */
export function candleGapMultipleFor(rulebook: Rulebook, symbol: string): number {
  const override = rulebook.instrument_max_candle_gap_multiple?.[symbol];
  return Number.isFinite(override) && (override as number) > 0
    ? (override as number)
    : rulebook.max_candle_gap_multiple;
}

/**
 * ARMING displacement thresholds — deliberately lower than the final quality
 * threshold `displacement_min_atr`. Opening a watch is cheap and reversible; an
 * alert is not. The measured displacement is preserved verbatim for scoring, so
 * a weak impulse simply scores lower, it is never rounded up.
 */
export const DEFAULT_ARMING_DISPLACEMENT_MIN_ATR = 0.6;

export const DEFAULT_INSTRUMENT_ARMING_DISPLACEMENT: Record<string, number> = {
  EURUSD: 0.6,
  GBPUSD: 0.6,
  USDJPY: 0.6,
  GBPAUD: 0.65,
  XAUUSD: 0.7,
};

/** Arming displacement threshold for one instrument (rulebook override wins). */
export function armingDisplacementFor(rulebook: Rulebook, symbol?: string | null): number {
  const perSymbol = symbol
    ? (rulebook.instrument_arming_displacement_min_atr?.[symbol] ??
      DEFAULT_INSTRUMENT_ARMING_DISPLACEMENT[symbol])
    : undefined;
  const base =
    rulebook.arming_displacement_min_atr ?? DEFAULT_ARMING_DISPLACEMENT_MIN_ATR;
  const chosen = Number.isFinite(perSymbol) && (perSymbol as number) > 0 ? (perSymbol as number) : base;
  // Arming can never be stricter than final quality; that would make the
  // stricter gate unreachable.
  return Math.min(chosen, rulebook.displacement_min_atr);
}



export type Candidate = {
  instrument: string;
  broker_symbol: string | null;
  timeframe: string;
  direction: "LONG" | "SHORT";
  setup_type: string;
  bias: Bias;
  entry_zone_low: number | null;
  entry_zone_high: number | null;
  stop_loss: number | null;
  targets: number[];
  rr_tp1: number | null;
  atr: number | null;
  spread: number | null;
  score: number | null;
  grade: "A_PLUS" | "A" | "B" | "C" | null;
  score_components: Record<string, number>;
  gate_results: GateResult[];
  reasons: string[];
  qualified: boolean;
  fingerprint: string | null;
  candle_time_utc: string | null;
};

/**
 * Setup families. The internal codes below are what the scanner has always
 * written to `signal_candidates.setup_type` and `signals.setup_type`; stored
 * rows are never rewritten. `SETUP_FAMILY_LABEL` carries the specification's
 * naming for display and for the Python reference engine, so the two
 * vocabularies map without a destructive data migration.
 */
export type SetupFamily =
  | "SWEEP_DISPLACEMENT_RETEST"
  | "PULLBACK_CONTINUATION"
  | "BREAK_RETEST";

export const SETUP_FAMILIES: SetupFamily[] = [
  "SWEEP_DISPLACEMENT_RETEST",
  "PULLBACK_CONTINUATION",
  "BREAK_RETEST",
];

export const SETUP_FAMILY_LABEL: Record<SetupFamily, string> = {
  SWEEP_DISPLACEMENT_RETEST: "Liquidity sweep reversal",
  PULLBACK_CONTINUATION: "Pullback continuation",
  BREAK_RETEST: "Break and retest continuation",
};

/** Specification aliases accepted on input, normalised to the internal code. */
export const SETUP_FAMILY_ALIASES: Record<string, SetupFamily> = {
  LIQUIDITY_SWEEP_REVERSAL: "SWEEP_DISPLACEMENT_RETEST",
  SWEEP_DISPLACEMENT_RETEST: "SWEEP_DISPLACEMENT_RETEST",
  BEARISH_PULLBACK_CONTINUATION: "PULLBACK_CONTINUATION",
  PULLBACK_CONTINUATION: "PULLBACK_CONTINUATION",
  BREAKOUT_RETEST_CONTINUATION: "BREAK_RETEST",
  SUPPORT_BREAK_RETEST: "BREAK_RETEST",
  BREAK_RETEST: "BREAK_RETEST",
};

export function normaliseSetupFamily(value: string | null | undefined): SetupFamily | null {
  if (!value) return null;
  return SETUP_FAMILY_ALIASES[value.trim().toUpperCase()] ?? null;
}
