/**
 * Shared scanner types. Pure data shapes — no trading logic, no secrets.
 */

export type Timeframe = "M5" | "M15" | "1h" | "4h" | "1d";

export const TIMEFRAMES: Timeframe[] = ["M5", "M15", "1h", "4h", "1d"];

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  M5: "M5",
  M15: "M15",
  "1h": "H1",
  "4h": "H4",
  "1d": "D1",
};

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
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
  | "DAILY_CAP";

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
  max_daily_actionable: number;
  max_data_age_seconds: number;
  max_spread_atr_ratio: number;
  late_entry_max_atr_from_entry: number;
  atr_period: number;
  swing_lookback: number;
  displacement_min_atr: number;
  grades: { A_PLUS: number; A: number; B: number };
};

export const DEFAULT_RULEBOOK: Rulebook = {
  version: "v1.1.0-shadow",
  closed_candles_only: true,
  min_rr_tp1: 2.0,
  max_daily_actionable: 2,
  max_data_age_seconds: 300,
  max_spread_atr_ratio: 0.15,
  late_entry_max_atr_from_entry: 0.5,
  atr_period: 14,
  swing_lookback: 5,
  displacement_min_atr: 1.0,
  grades: { A_PLUS: 95, A: 90, B: 80 },
};

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
  grade: "A_PLUS" | "A" | "B" | null;
  score_components: Record<string, number>;
  gate_results: GateResult[];
  reasons: string[];
  qualified: boolean;
  fingerprint: string | null;
  candle_time_utc: string | null;
};
