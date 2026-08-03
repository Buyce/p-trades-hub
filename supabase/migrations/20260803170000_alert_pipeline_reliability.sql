-- Alert-pipeline reliability -------------------------------------------------
-- This migration changes no trading threshold. It makes the existing
-- context -> precision -> ENTRY_READY -> notification flow explicit,
-- retryable and reproducible across environments.

-- 1. Do not confuse the broad structural trigger area with the final narrow
-- execution zone created after the M1 break.
ALTER TABLE public.precision_watches
  ADD COLUMN IF NOT EXISTS arming_zone_low numeric,
  ADD COLUMN IF NOT EXISTS arming_zone_high numeric;

UPDATE public.precision_watches
   SET arming_zone_low = COALESCE(arming_zone_low, entry_zone_low),
       arming_zone_high = COALESCE(arming_zone_high, entry_zone_high)
 WHERE arming_zone_low IS NULL OR arming_zone_high IS NULL;

COMMENT ON COLUMN public.precision_watches.arming_zone_low IS
  'Lower edge of the broad M15 structural area in which M1 may search for a trigger.';
COMMENT ON COLUMN public.precision_watches.arming_zone_high IS
  'Upper edge of the broad M15 structural area in which M1 may search for a trigger.';

-- 2. Durable notification outbox. The signal transition and event insert are
-- committed together; delivery can then retry without losing the alert.
CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','FAILED_RETRYABLE','SENT','DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  sent_at timestamptz,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_id)
);

CREATE INDEX IF NOT EXISTS notification_outbox_ready_idx
  ON public.notification_outbox (status, available_at, created_at)
  WHERE status IN ('PENDING','FAILED_RETRYABLE');

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_outbox FROM anon, authenticated;
GRANT ALL ON public.notification_outbox TO service_role;

-- Existing test messages must not occupy the idempotency slot for the real
-- actionable signal.
UPDATE public.notifications
   SET signal_id = NULL
 WHERE signal_id IS NOT NULL AND title LIKE '[TEST] %';

DELETE FROM public.notifications duplicate
USING public.notifications keeper
WHERE duplicate.user_id = keeper.user_id
  AND duplicate.signal_id = keeper.signal_id
  AND duplicate.signal_id IS NOT NULL
  AND duplicate.id > keeper.id;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_signal_idx
  ON public.notifications (user_id, signal_id);

CREATE OR REPLACE FUNCTION public.enqueue_entry_ready_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_actionable IS TRUE
     AND NEW.lifecycle_state = 'ENTRY_READY'
     AND NEW.shadow_mode IS FALSE
  THEN
    IF TG_OP = 'INSERT'
       OR OLD.is_actionable IS DISTINCT FROM TRUE
       OR OLD.lifecycle_state IS DISTINCT FROM 'ENTRY_READY'
    THEN
      INSERT INTO public.notification_outbox (signal_id, payload)
      VALUES (
        NEW.id,
        jsonb_build_object(
          'shadowMode', NEW.shadow_mode,
          'signalId', NEW.id,
          'instrument', NEW.instrument,
          'direction', NEW.direction,
          'grade', NEW.grade,
          'setupType', NEW.setup_type,
          'timeframe', COALESCE(NEW.trigger_timeframe, NEW.timeframe),
          'entryZoneLow', NEW.entry_zone_low,
          'entryZoneHigh', NEW.entry_zone_high,
          'stopLoss', NEW.stop_loss,
          'targets', COALESCE(NEW.targets, '[]'::jsonb),
          'rr', NEW.rr_tp1,
          'score', NEW.score,
          'reasons', COALESCE(NEW.reasons, '[]'::jsonb)
        )
      )
      ON CONFLICT (signal_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_entry_ready_notification() FROM public;

DROP TRIGGER IF EXISTS enqueue_entry_ready_notification ON public.signals;
CREATE TRIGGER enqueue_entry_ready_notification
AFTER INSERT OR UPDATE OF is_actionable, lifecycle_state ON public.signals
FOR EACH ROW EXECUTE FUNCTION public.enqueue_entry_ready_notification();

-- 3. One rulebook authority. This aligns the setting to the currently active
-- immutable row; it does not alter a strategy value.
UPDATE public.scanner_settings settings
   SET rulebook_version = active.version,
       updated_at = now()
  FROM LATERAL (
    SELECT version
      FROM public.rulebook_versions
     WHERE is_active = true
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1
  ) active
 WHERE settings.id = true
   AND settings.rulebook_version IS DISTINCT FROM active.version;

-- 4. Reproducible scheduler. M1 data and precision now run every minute;
-- context remains the heavier three-minute job. pg_cron has one-minute
-- granularity, so quote-only checks run once per minute without long-lived
-- request loops or overlapping locks.
SELECT cron.unschedule('ptrades-sync-market-data');
SELECT cron.unschedule('ptrades-scan-context');
SELECT cron.unschedule('ptrades-scan-precision');
SELECT cron.unschedule('ptrades-deliver-alerts');

SELECT cron.schedule(
  'ptrades-sync-market-data',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/sync-market-data',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'ptrades-scan-context',
  '1-59/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/scan-context',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'ptrades-scan-precision',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/scan-precision',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Delivery has its own job so an ENTRY_READY event is retried even if the
-- precision route is locked or temporarily failing. The precision route also
-- drains once immediately, making this job the independent retry path.
SELECT cron.schedule(
  'ptrades-deliver-alerts',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4af8a9c2-5323-4209-8566-b5d76fe22042.lovable.app/api/public/hooks/deliver-alerts',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_kUs7xhovIrPMyuXbJCcdSg_gekfzftu"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
