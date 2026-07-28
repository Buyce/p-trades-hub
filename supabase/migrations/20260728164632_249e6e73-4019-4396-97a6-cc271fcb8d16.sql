ALTER TABLE public.precision_watches
  ADD COLUMN IF NOT EXISTS last_m1_candle_time timestamp with time zone;

COMMENT ON COLUMN public.precision_watches.last_m1_candle_time IS
  'Close time of the newest closed M1 candle already analysed for this watch. Used to skip re-downloading unchanged M1 series between closes.';

-- Clear any lock left behind by a killed worker so the next tick can run.
DELETE FROM public.scanner_locks WHERE expires_at < now();