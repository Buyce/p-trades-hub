-- Signed-out visitors get nothing anywhere in public.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t.tablename);
  END LOOP;
END $$;

-- Scanner-owned data is read-only to every signed-in browser client.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'signals','signal_candidates','signal_rejections','scanner_runs','scanner_errors',
    'scanner_locks','scanner_settings','system_heartbeats','audit_log','instruments',
    'rulebook_versions','candles_cache','daily_alert_counters','macro_events','user_roles'
  ] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- User-owned journal data keeps full CRUD for signed-in users (RLS scopes rows).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trades TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;