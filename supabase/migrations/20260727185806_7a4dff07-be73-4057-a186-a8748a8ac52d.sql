-- 1. Distributed scanner lock -------------------------------------------------
CREATE TABLE public.scanner_locks (
  lock_key text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  holder text
);

GRANT ALL ON public.scanner_locks TO service_role;
GRANT SELECT ON public.scanner_locks TO authenticated;

ALTER TABLE public.scanner_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scanner locks staff read"
  ON public.scanner_locks FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.acquire_scanner_lock(
  _key text,
  _ttl_seconds integer DEFAULT 120,
  _holder text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ok boolean;
BEGIN
  DELETE FROM public.scanner_locks WHERE lock_key = _key AND expires_at < now();

  INSERT INTO public.scanner_locks (lock_key, locked_at, expires_at, holder)
  VALUES (_key, now(), now() + make_interval(secs => _ttl_seconds), _holder)
  ON CONFLICT (lock_key) DO NOTHING;

  GET DIAGNOSTICS _ok = ROW_COUNT;
  RETURN _ok;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_scanner_lock(text, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_scanner_lock(text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_scanner_lock(_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.scanner_locks WHERE lock_key = _key;
$$;

REVOKE ALL ON FUNCTION public.release_scanner_lock(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_scanner_lock(text) TO service_role;

-- 2. Atomic daily actionable-slot claim ---------------------------------------
CREATE OR REPLACE FUNCTION public.claim_actionable_slot(
  _day date,
  _max integer DEFAULT 2
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  INSERT INTO public.daily_alert_counters (trading_day_utc, actionable_count, max_allowed)
  VALUES (_day, 0, _max)
  ON CONFLICT (trading_day_utc) DO NOTHING;

  UPDATE public.daily_alert_counters
     SET actionable_count = actionable_count + 1,
         max_allowed = _max,
         updated_at = now()
   WHERE trading_day_utc = _day
     AND actionable_count < _max
  RETURNING actionable_count INTO _count;

  RETURN _count IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_actionable_slot(date, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_actionable_slot(date, integer) TO service_role;

-- 3. Symbol mapping layer ------------------------------------------------------
ALTER TABLE public.instruments
  ADD COLUMN IF NOT EXISTS digits integer,
  ADD COLUMN IF NOT EXISTS point_size numeric,
  ADD COLUMN IF NOT EXISTS contract_size numeric,
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS base_currency text,
  ADD COLUMN IF NOT EXISTS quote_currency text,
  ADD COLUMN IF NOT EXISTS sessions text[] NOT NULL DEFAULT '{LONDON,NEWYORK}'::text[],
  ADD COLUMN IF NOT EXISTS max_data_age_seconds integer;

-- 4. Per-symbol macro lockouts -------------------------------------------------
ALTER TABLE public.macro_events
  ADD COLUMN IF NOT EXISTS symbols text[] NOT NULL DEFAULT '{}'::text[];