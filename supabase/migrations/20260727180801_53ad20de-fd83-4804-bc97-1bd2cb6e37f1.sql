-- Watchlist
CREATE TABLE public.instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL UNIQUE,
  broker_symbol text,
  display_name text,
  enabled boolean NOT NULL DEFAULT false,
  min_rr numeric NOT NULL DEFAULT 2.0,
  max_spread numeric,
  sort_order integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.instruments TO authenticated;
GRANT ALL ON public.instruments TO service_role;
ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "instruments read" ON public.instruments FOR SELECT TO authenticated USING (true);
CREATE TRIGGER instruments_updated_at BEFORE UPDATE ON public.instruments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Scanner settings (singleton)
CREATE TABLE public.scanner_settings (
  id boolean PRIMARY KEY DEFAULT true,
  shadow_mode boolean NOT NULL DEFAULT true,
  max_daily_alerts integer NOT NULL DEFAULT 2,
  min_rr numeric NOT NULL DEFAULT 2.0,
  scanning_enabled boolean NOT NULL DEFAULT true,
  rulebook_version text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scanner_settings_singleton CHECK (id)
);
GRANT SELECT ON public.scanner_settings TO authenticated;
GRANT ALL ON public.scanner_settings TO service_role;
ALTER TABLE public.scanner_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scanner settings read" ON public.scanner_settings FOR SELECT TO authenticated USING (true);
CREATE TRIGGER scanner_settings_updated_at BEFORE UPDATE ON public.scanner_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Candidates
CREATE TABLE public.signal_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanner_run_id uuid,
  instrument text NOT NULL,
  broker_symbol text,
  timeframe text,
  direction text,
  setup_type text,
  bias text,
  entry_zone_low numeric,
  entry_zone_high numeric,
  stop_loss numeric,
  targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  rr_tp1 numeric,
  atr numeric,
  spread numeric,
  score numeric,
  grade signal_grade,
  score_components jsonb NOT NULL DEFAULT '{}'::jsonb,
  gate_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  qualified boolean NOT NULL DEFAULT false,
  promoted_signal_id uuid,
  fingerprint text,
  shadow_mode boolean NOT NULL DEFAULT true,
  rulebook_version text,
  candle_time_utc timestamptz,
  evaluated_at_utc timestamptz NOT NULL DEFAULT now(),
  trading_day_utc date NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.signal_candidates TO authenticated;
GRANT ALL ON public.signal_candidates TO service_role;
ALTER TABLE public.signal_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "candidates read" ON public.signal_candidates FOR SELECT TO authenticated USING (true);
CREATE INDEX signal_candidates_day_idx ON public.signal_candidates (trading_day_utc, evaluated_at_utc DESC);
CREATE INDEX signal_candidates_instrument_idx ON public.signal_candidates (instrument, evaluated_at_utc DESC);

-- Rejections
CREATE TABLE public.signal_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.signal_candidates(id) ON DELETE CASCADE,
  scanner_run_id uuid,
  instrument text NOT NULL,
  timeframe text,
  gate_code text NOT NULL,
  reason text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  trading_day_utc date NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.signal_rejections TO authenticated;
GRANT ALL ON public.signal_rejections TO service_role;
ALTER TABLE public.signal_rejections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rejections read" ON public.signal_rejections FOR SELECT TO authenticated USING (true);
CREATE INDEX signal_rejections_day_idx ON public.signal_rejections (trading_day_utc, created_at DESC);
CREATE INDEX signal_rejections_candidate_idx ON public.signal_rejections (candidate_id);

-- Last closed candle cache
CREATE TABLE public.candles_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument text NOT NULL,
  timeframe text NOT NULL,
  candle_time_utc timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume numeric,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instrument, timeframe)
);
GRANT SELECT ON public.candles_cache TO authenticated;
GRANT ALL ON public.candles_cache TO service_role;
ALTER TABLE public.candles_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "candles cache read" ON public.candles_cache FOR SELECT TO authenticated USING (true);

-- Daily actionable alert counter
CREATE TABLE public.daily_alert_counters (
  trading_day_utc date PRIMARY KEY,
  actionable_count integer NOT NULL DEFAULT 0,
  max_allowed integer NOT NULL DEFAULT 2,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.daily_alert_counters TO authenticated;
GRANT ALL ON public.daily_alert_counters TO service_role;
ALTER TABLE public.daily_alert_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily counters read" ON public.daily_alert_counters FOR SELECT TO authenticated USING (true);
CREATE TRIGGER daily_alert_counters_updated_at BEFORE UPDATE ON public.daily_alert_counters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Signals gain candidate linkage, duplicate fingerprint and shadow flag
ALTER TABLE public.signals
  ADD COLUMN candidate_id uuid,
  ADD COLUMN fingerprint text,
  ADD COLUMN shadow_mode boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX signals_fingerprint_day_idx
  ON public.signals (fingerprint, trading_day_utc)
  WHERE fingerprint IS NOT NULL;

-- Seed watchlist
INSERT INTO public.instruments (symbol, broker_symbol, display_name, enabled, min_rr, sort_order, note) VALUES
  ('XAUUSD', 'XAUUSD', 'Gold vs US Dollar', true, 2.0, 1, NULL),
  ('GBPAUD', 'GBPAUD', 'Pound vs Australian Dollar', true, 2.0, 2, NULL),
  ('GBPUSD', 'GBPUSD', 'Pound vs US Dollar', true, 2.0, 3, NULL),
  ('EURUSD', 'EURUSD', 'Euro vs US Dollar', true, 2.0, 4, NULL),
  ('USDJPY', 'USDJPY', 'US Dollar vs Japanese Yen', true, 2.0, 5, NULL),
  ('NAS100', NULL, 'Nasdaq 100 index', false, 2.0, 6, 'Disabled until the broker symbol is discovered.');

-- Seed scanner settings in shadow mode
INSERT INTO public.scanner_settings (id, shadow_mode, max_daily_alerts, min_rr, scanning_enabled, rulebook_version)
VALUES (true, true, 2, 2.0, true, 'v1.0.0-shadow');

-- Seed the active rulebook the scanner reads at scan time
INSERT INTO public.rulebook_versions (version, is_active, summary, rules)
VALUES (
  'v1.0.0-shadow',
  true,
  'Deterministic P-Trades rules, shadow mode. Closed candles only, min 2.0R to TP1, max 2 actionable alerts per UTC day.',
  '{
    "timeframes": {"entry": ["M5", "M15"], "structure": ["H1"], "bias": ["H4", "D1"]},
    "closed_candles_only": true,
    "min_rr_tp1": 2.0,
    "max_daily_actionable": 2,
    "max_data_age_seconds": 300,
    "max_spread_atr_ratio": 0.15,
    "late_entry_max_atr_from_entry": 0.5,
    "atr_period": 14,
    "swing_lookback": 5,
    "displacement_min_atr": 1.0,
    "grades": {"A_PLUS": 90, "A": 80, "B": 70},
    "gates": [
      "MISSING_DATA", "STALE_DATA", "SPREAD", "NEWS_LOCKOUT", "BIAS_CONFLICT",
      "NO_SWEEP", "NO_DISPLACEMENT", "NO_RETEST", "INVALID_STOP", "RR_BELOW_MIN",
      "LATE_ENTRY", "DUPLICATE", "DAILY_CAP"
    ]
  }'::jsonb
);