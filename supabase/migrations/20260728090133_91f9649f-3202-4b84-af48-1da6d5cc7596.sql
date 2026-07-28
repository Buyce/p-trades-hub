CREATE OR REPLACE FUNCTION public.purge_scanner_diagnostics(
  retain_rejections interval DEFAULT interval '5 hours',
  retain_candidates interval DEFAULT interval '24 hours',
  retain_runs interval DEFAULT interval '3 days',
  retain_errors interval DEFAULT interval '7 days'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
  _rej integer := 0;
  _cand integer := 0;
  _runs integer := 0;
  _errs integer := 0;
  _result jsonb;
BEGIN
  IF retain_rejections IS NOT NULL THEN
    DELETE FROM public.signal_rejections WHERE created_at < _now - retain_rejections;
    GET DIAGNOSTICS _rej = ROW_COUNT;
  END IF;

  IF retain_candidates IS NOT NULL THEN
    UPDATE public.signals s
       SET candidate_id = NULL
      FROM public.signal_candidates c
     WHERE s.candidate_id = c.id
       AND c.created_at < _now - retain_candidates;

    UPDATE public.signal_rejections r
       SET candidate_id = NULL
      FROM public.signal_candidates c
     WHERE r.candidate_id = c.id
       AND c.created_at < _now - retain_candidates;

    DELETE FROM public.signal_candidates WHERE created_at < _now - retain_candidates;
    GET DIAGNOSTICS _cand = ROW_COUNT;
  END IF;

  IF retain_runs IS NOT NULL THEN
    UPDATE public.signals s
       SET scanner_run_id = NULL
      FROM public.scanner_runs r
     WHERE s.scanner_run_id = r.id
       AND r.created_at < _now - retain_runs;

    UPDATE public.scanner_errors e
       SET scanner_run_id = NULL
      FROM public.scanner_runs r
     WHERE e.scanner_run_id = r.id
       AND r.created_at < _now - retain_runs;

    UPDATE public.signal_candidates c
       SET scanner_run_id = NULL
      FROM public.scanner_runs r
     WHERE c.scanner_run_id = r.id
       AND r.created_at < _now - retain_runs;

    UPDATE public.signal_rejections sr
       SET scanner_run_id = NULL
      FROM public.scanner_runs r
     WHERE sr.scanner_run_id = r.id
       AND r.created_at < _now - retain_runs;

    DELETE FROM public.scanner_runs WHERE created_at < _now - retain_runs;
    GET DIAGNOSTICS _runs = ROW_COUNT;
  END IF;

  IF retain_errors IS NOT NULL THEN
    DELETE FROM public.scanner_errors WHERE created_at < _now - retain_errors;
    GET DIAGNOSTICS _errs = ROW_COUNT;
  END IF;

  _result := jsonb_build_object(
    'signal_rejections', _rej,
    'signal_candidates', _cand,
    'scanner_runs', _runs,
    'scanner_errors', _errs,
    'retention', jsonb_build_object(
      'signal_rejections', retain_rejections::text,
      'signal_candidates', retain_candidates::text,
      'scanner_runs', retain_runs::text,
      'scanner_errors', retain_errors::text
    )
  );

  INSERT INTO public.audit_log (actor_kind, action, entity_type, detail)
  VALUES ('SYSTEM', 'SCANNER_DIAGNOSTICS_PURGE', 'scanner_diagnostics', _result);

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_scanner_diagnostics(interval, interval, interval, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_scanner_diagnostics(interval, interval, interval, interval) FROM anon;
REVOKE ALL ON FUNCTION public.purge_scanner_diagnostics(interval, interval, interval, interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_scanner_diagnostics(interval, interval, interval, interval) TO service_role;