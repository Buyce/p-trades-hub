REVOKE ALL ON FUNCTION public.renew_scanner_lock(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_market_candles(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_scanner_lock(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_market_candles(interval) TO service_role;