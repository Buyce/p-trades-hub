CREATE TABLE public.precision_watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  broker_symbol text,
  direction text NOT NULL,
  state text NOT NULL DEFAULT 'ARMED',
  structural_level numeric,
  entry_anchor numeric,
  anchor_source text,
  preferred_entry numeric,
  entry_zone_low numeric,
  entry_zone_high numeric,
  zone_width_points numeric,
  stop_loss numeric,
  targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  trigger_level numeric,
  trigger_timeframe text,
  trigger_candle_time timestamptz,
  trigger_summary text,
  invalidation_price numeric,
  invalidation_condition text,
  invalidation_timeframe text,
  armed_at timestamptz NOT NULL DEFAULT now(),
  entry_ready_at timestamptz,
  resolved_at timestamptz,
  expires_at timestamptz NOT NULL,
  last_checked_at timestamptz,
  check_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_id)
);

GRANT SELECT ON public.precision_watches TO authenticated;
GRANT ALL ON public.precision_watches TO service_role;

ALTER TABLE public.precision_watches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read precision watches"
ON public.precision_watches FOR SELECT TO authenticated USING (true);

CREATE TRIGGER update_precision_watches_updated_at
BEFORE UPDATE ON public.precision_watches
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX precision_watches_open_idx
  ON public.precision_watches (state, expires_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'DETECTED',
  ADD COLUMN IF NOT EXISTS preferred_entry numeric,
  ADD COLUMN IF NOT EXISTS zone_width_points numeric,
  ADD COLUMN IF NOT EXISTS price_at_alert numeric,
  ADD COLUMN IF NOT EXISTS distance_to_entry_points numeric,
  ADD COLUMN IF NOT EXISTS trigger_timeframe text,
  ADD COLUMN IF NOT EXISTS trigger_level numeric,
  ADD COLUMN IF NOT EXISTS trigger_candle_time timestamptz,
  ADD COLUMN IF NOT EXISTS trigger_summary text,
  ADD COLUMN IF NOT EXISTS invalidation_price numeric,
  ADD COLUMN IF NOT EXISTS invalidation_timeframe text,
  ADD COLUMN IF NOT EXISTS armed_at timestamptz,
  ADD COLUMN IF NOT EXISTS entry_ready_at timestamptz;

INSERT INTO public.rulebook_versions (version, is_active, status, summary, change_summary, author, effective_from, rules)
VALUES (
  'v2.0.0-live',
  false,
  'DRAFT',
  'Two-stage precision entry engine: M15 setup detection separated from closed-M1 execution timing.',
  'Adds precision block: adaptive asymmetric entry zones, proximity gate, extension-R late entry, armed/trigger expiry, mandatory structural invalidation.',
  'lovable-agent',
  now(),
  jsonb_build_object(
    'version', 'v2.0.0-live',
    'closed_candles_only', true,
    'min_rr_tp1', 2.0,
    'max_daily_actionable', 0,
    'max_data_age_seconds', 300,
    'max_spread_atr_ratio', 0.15,
    'late_entry_max_atr_from_entry', 1.5,
    'atr_period', 14,
    'atr_method', 'WILDER',
    'swing_lookback', 5,
    'displacement_min_atr', 1.0,
    'allowed_sessions', jsonb_build_array('LONDON','NEWYORK'),
    'signal_expiry_minutes', 60,
    'max_candle_gap_multiple', 6,
    'instrument_max_candle_gap_multiple', jsonb_build_object('XAUUSD', 16, 'NAS100', 16),
    'macro_lookahead_minutes', 60,
    'max_stop_atr_multiple', 4,
    'grades', jsonb_build_object('A_PLUS', 95, 'A', 90, 'B', 84, 'C', 78),
    'tier_min_rr', jsonb_build_object('A_PLUS', 2.0, 'A', 2.0, 'B', 1.5, 'C', 1.2),
    'tier_daily_max', jsonb_build_object('A', 0, 'B', 0, 'C', 0),
    'precision', jsonb_build_object(
      'enabled', true,
      'armed_expiry_minutes', 30,
      'trigger_expiry_bars', 3,
      'min_entry_ready_rr', 2.0,
      'default', jsonb_build_object('min', 4, 'max', 10, 'spreadMult', 2.0, 'atrM1', 0.05, 'atrM5', 0.02, 'maxExtensionR', 0.15, 'proximityPoints', 6, 'armedExpiryMinutes', 30),
      'instruments', jsonb_build_object(
        'EURUSD', jsonb_build_object('min', 3, 'max', 8, 'spreadMult', 2.0, 'atrM1', 0.05, 'atrM5', 0.02, 'maxExtensionR', 0.15, 'proximityPoints', 5, 'armedExpiryMinutes', 30),
        'GBPUSD', jsonb_build_object('min', 4, 'max', 10, 'spreadMult', 2.0, 'atrM1', 0.05, 'atrM5', 0.02, 'maxExtensionR', 0.15, 'proximityPoints', 6, 'armedExpiryMinutes', 30),
        'GBPAUD', jsonb_build_object('min', 6, 'max', 14, 'spreadMult', 2.0, 'atrM1', 0.06, 'atrM5', 0.025, 'maxExtensionR', 0.18, 'proximityPoints', 8, 'armedExpiryMinutes', 30),
        'USDJPY', jsonb_build_object('min', 3, 'max', 8, 'spreadMult', 2.0, 'atrM1', 0.05, 'atrM5', 0.02, 'maxExtensionR', 0.15, 'proximityPoints', 5, 'armedExpiryMinutes', 30),
        'XAUUSD', jsonb_build_object('min', 20, 'max', 80, 'spreadMult', 2.0, 'atrM1', 0.04, 'atrM5', 0.015, 'maxExtensionR', 0.12, 'proximityPoints', 30, 'armedExpiryMinutes', 20),
        'NAS100', jsonb_build_object('min', 20, 'max', 80, 'spreadMult', 2.0, 'atrM1', 0.04, 'atrM5', 0.015, 'maxExtensionR', 0.12, 'proximityPoints', 30, 'armedExpiryMinutes', 20)
      )
    )
  )
);