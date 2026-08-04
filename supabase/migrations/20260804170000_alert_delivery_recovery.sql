-- Alert-delivery recovery ---------------------------------------------------
-- Reliability only: no setup, score, reward/risk or timing threshold changes.
--
-- This migration is intentionally idempotent. It repairs deployments where
-- the application code reached production but the outbox trigger or pg_cron
-- job did not, and safely queues any still-live ENTRY_READY signal that was
-- stranded during that interval.

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
          'grade', COALESCE(NEW.final_grade, NEW.grade),
          'setupType', NEW.setup_type,
          'timeframe', COALESCE(NEW.trigger_timeframe, NEW.timeframe),
          'entryZoneLow', NEW.entry_zone_low,
          'entryZoneHigh', NEW.entry_zone_high,
          'stopLoss', NEW.stop_loss,
          'targets', COALESCE(NEW.targets, '[]'::jsonb),
          'rr', NEW.rr_tp1,
          'score', COALESCE(NEW.final_score, NEW.score),
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

-- Recover only current, still-actionable alerts. Expired history is not queued
-- and users who already have an in-app notification are not notified twice.
INSERT INTO public.notification_outbox (signal_id, payload)
SELECT
  signal.id,
  jsonb_build_object(
    'shadowMode', signal.shadow_mode,
    'signalId', signal.id,
    'instrument', signal.instrument,
    'direction', signal.direction,
    'grade', COALESCE(signal.final_grade, signal.grade),
    'setupType', signal.setup_type,
    'timeframe', COALESCE(signal.trigger_timeframe, signal.timeframe),
    'entryZoneLow', signal.entry_zone_low,
    'entryZoneHigh', signal.entry_zone_high,
    'stopLoss', signal.stop_loss,
    'targets', COALESCE(signal.targets, '[]'::jsonb),
    'rr', signal.rr_tp1,
    'score', COALESCE(signal.final_score, signal.score),
    'reasons', COALESCE(signal.reasons, '[]'::jsonb)
  )
FROM public.signals signal
WHERE signal.is_actionable IS TRUE
  AND signal.lifecycle_state = 'ENTRY_READY'
  AND signal.shadow_mode IS FALSE
  AND (signal.expires_at_utc IS NULL OR signal.expires_at_utc > now())
  AND NOT EXISTS (
    SELECT 1
    FROM public.notifications notification
    WHERE notification.signal_id = signal.id
  )
ON CONFLICT (signal_id) DO NOTHING;

-- Never allow duplicate job names to survive a restore/replay. Unscheduling by
-- job id is safe even when a named job is absent (cron.unschedule(name) is not).
DO $block$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'ptrades-sync-market-data',
      'ptrades-scan-context',
      'ptrades-scan-precision',
      'ptrades-deliver-alerts'
    )
  LOOP
    PERFORM cron.unschedule(existing.jobid);
  END LOOP;
END;
$block$;

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

NOTIFY pgrst, 'reload schema';
