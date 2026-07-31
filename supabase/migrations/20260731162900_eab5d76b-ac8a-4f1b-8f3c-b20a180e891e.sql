ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS backfill_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backfill_max_bars_per_tick integer NOT NULL DEFAULT 250,
  ADD COLUMN IF NOT EXISTS backfill_budget_ms integer NOT NULL DEFAULT 12000,
  ADD COLUMN IF NOT EXISTS backfill_cursor jsonb NOT NULL DEFAULT '{}'::jsonb;