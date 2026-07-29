ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS provisional_score numeric,
  ADD COLUMN IF NOT EXISTS provisional_grade public.signal_grade,
  ADD COLUMN IF NOT EXISTS final_score numeric,
  ADD COLUMN IF NOT EXISTS final_grade public.signal_grade,
  ADD COLUMN IF NOT EXISTS final_score_components jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS score_calculated_at timestamptz;

ALTER TABLE public.precision_watches
  ADD COLUMN IF NOT EXISTS triggered_at timestamptz,
  ADD COLUMN IF NOT EXISTS retest_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS provisional_score numeric,
  ADD COLUMN IF NOT EXISTS provisional_grade public.signal_grade;

COMMENT ON TABLE public.daily_alert_counters IS 'DEPRECATED: P-Trades no longer enforces a daily alert cap. Retained for history only; not read or written by the scanner.';