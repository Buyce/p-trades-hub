REVOKE ALL ON FUNCTION public.claim_actionable_slot(date, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_actionable_slot(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_scanner_lock(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_scanner_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_actionable_slot(date, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_scanner_lock(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_scanner_lock(text) TO service_role;