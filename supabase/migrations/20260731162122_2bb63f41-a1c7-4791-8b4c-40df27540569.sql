ALTER TABLE public.scanner_settings
  ADD COLUMN IF NOT EXISTS alert_test_mode boolean NOT NULL DEFAULT false;