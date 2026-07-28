-- Holder-aware scanner lock: atomic acquire that replaces expired locks,
-- and a release that only succeeds for the current owner.
CREATE OR REPLACE FUNCTION public.acquire_scanner_lock(_key text, _ttl_seconds integer DEFAULT 120, _holder text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ok boolean;
BEGIN
  INSERT INTO public.scanner_locks (lock_key, locked_at, expires_at, holder)
  VALUES (_key, now(), now() + make_interval(secs => _ttl_seconds), _holder)
  ON CONFLICT (lock_key) DO UPDATE
     SET locked_at = now(),
         expires_at = now() + make_interval(secs => _ttl_seconds),
         holder = EXCLUDED.holder
   WHERE public.scanner_locks.expires_at < now();

  GET DIAGNOSTICS _ok = ROW_COUNT;
  RETURN _ok;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_scanner_lock(_key text, _holder text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ok boolean;
BEGIN
  DELETE FROM public.scanner_locks
   WHERE lock_key = _key
     AND (_holder IS NULL OR holder IS NOT DISTINCT FROM _holder);
  GET DIAGNOSTICS _ok = ROW_COUNT;
  RETURN _ok;
END;
$function$;