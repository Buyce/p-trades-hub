ALTER TYPE public.signal_grade ADD VALUE IF NOT EXISTS 'C';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS alert_tiers_email text[] NOT NULL DEFAULT ARRAY['A_PLUS','A']::text[],
  ADD COLUMN IF NOT EXISTS alert_tiers_push text[] NOT NULL DEFAULT ARRAY['A_PLUS','A']::text[],
  ADD COLUMN IF NOT EXISTS alert_tiers_terminal text[] NOT NULL DEFAULT ARRAY['A_PLUS','A','B','C']::text[];

ALTER TABLE public.daily_alert_counters
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'A';

ALTER TABLE public.daily_alert_counters DROP CONSTRAINT IF EXISTS daily_alert_counters_pkey;
ALTER TABLE public.daily_alert_counters
  ADD CONSTRAINT daily_alert_counters_pkey PRIMARY KEY (trading_day_utc, tier);

CREATE OR REPLACE FUNCTION public.claim_actionable_slot(_day date, _max integer DEFAULT 2, _tier text DEFAULT 'A')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _count integer;
BEGIN
  INSERT INTO public.daily_alert_counters (trading_day_utc, tier, actionable_count, max_allowed)
  VALUES (_day, _tier, 0, _max)
  ON CONFLICT (trading_day_utc, tier) DO NOTHING;

  UPDATE public.daily_alert_counters
     SET actionable_count = actionable_count + 1,
         max_allowed = _max,
         updated_at = now()
   WHERE trading_day_utc = _day
     AND tier = _tier
     AND actionable_count < _max
  RETURNING actionable_count INTO _count;

  RETURN _count IS NOT NULL;
END;
$function$;

UPDATE public.scanner_runs
   SET status = 'TIMEOUT',
       finished_at = started_at + interval '3 minutes',
       error_message = COALESCE(error_message, 'Run did not finish within the scan lock TTL.')
 WHERE status = 'RUNNING'
   AND started_at < now() - interval '10 minutes';