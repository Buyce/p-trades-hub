REVOKE ALL ON FUNCTION public.acquire_scanner_lock(text, integer, text) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.release_scanner_lock(text, text) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.release_scanner_lock(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.acquire_scanner_lock(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_scanner_lock(text, text) TO service_role;