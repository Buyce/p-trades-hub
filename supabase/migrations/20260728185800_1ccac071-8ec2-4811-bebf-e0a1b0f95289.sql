-- 1. Durable candle-series cache -------------------------------------------
CREATE TABLE IF NOT EXISTS public.market_candles (
  instrument text NOT NULL,
  broker_symbol text NOT NULL,
  timeframe text NOT NULL,
  open_time timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume numeric,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (broker_symbol, timeframe, open_time)
);

GRANT SELECT ON public.market_candles TO authenticated;
GRANT ALL ON public.market_candles TO service_role;

ALTER TABLE public.market_candles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read cached candles"
  ON public.market_candles FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS market_candles_lookup_idx
  ON public.market_candles (broker_symbol, timeframe, open_time DESC);

CREATE INDEX IF NOT EXISTS market_candles_instrument_idx
  ON public.market_candles (instrument, timeframe, open_time DESC);

-- 2. Bias policy, chronology and structural identity -------------------------
ALTER TABLE public.signal_candidates
  ADD COLUMN IF NOT EXISTS bias_policy text,
  ADD COLUMN IF NOT EXISTS prior_h4_bias text,
  ADD COLUMN IF NOT EXISTS prior_d1_bias text,
  ADD COLUMN IF NOT EXISTS bias_policy_passed boolean,
  ADD COLUMN IF NOT EXISTS bias_policy_reason text,
  ADD COLUMN IF NOT EXISTS sequence_valid boolean,
  ADD COLUMN IF NOT EXISTS structural_idea_id text;

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS structural_idea_id text,
  ADD COLUMN IF NOT EXISTS bias_policy text,
  ADD COLUMN IF NOT EXISTS bias_policy_reason text;

ALTER TABLE public.precision_watches
  ADD COLUMN IF NOT EXISTS structural_idea_id text;

CREATE INDEX IF NOT EXISTS signal_candidates_idea_idx
  ON public.signal_candidates (structural_idea_id);

CREATE INDEX IF NOT EXISTS signals_idea_idx
  ON public.signals (structural_idea_id);

CREATE UNIQUE INDEX IF NOT EXISTS precision_watches_active_idea_idx
  ON public.precision_watches (structural_idea_id)
  WHERE resolved_at IS NULL AND structural_idea_id IS NOT NULL;

-- 3. Lease renewal for long-running scans ------------------------------------
CREATE OR REPLACE FUNCTION public.renew_scanner_lock(
  _key text,
  _holder text,
  _ttl_seconds integer DEFAULT 120
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ok boolean;
BEGIN
  UPDATE public.scanner_locks
     SET expires_at = now() + make_interval(secs => _ttl_seconds)
   WHERE lock_key = _key
     AND holder IS NOT DISTINCT FROM _holder;
  GET DIAGNOSTICS _ok = ROW_COUNT;
  RETURN _ok;
END;
$function$;

REVOKE ALL ON FUNCTION public.renew_scanner_lock(text, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.renew_scanner_lock(text, text, integer) TO service_role;

-- 4. Retention for the new cache table ---------------------------------------
CREATE OR REPLACE FUNCTION public.purge_market_candles(retain interval DEFAULT '14 days'::interval)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _n integer := 0;
BEGIN
  DELETE FROM public.market_candles WHERE open_time < now() - retain;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_market_candles(interval) FROM public;
GRANT EXECUTE ON FUNCTION public.purge_market_candles(interval) TO service_role;