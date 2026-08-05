-- Runtime pipeline recovery -------------------------------------------------
-- Reliability only: no detection, score, reward/risk or timing thresholds.
--
-- The generated post-merge migration created the outbox table but omitted the
-- enqueue trigger and both supporting cron jobs. This migration repairs that
-- split deployment without embedding a deployment URL or API credential. It
-- derives every route command from one of the already-working P-Trades jobs.

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
     AND (
       TG_OP = 'INSERT'
       OR OLD.is_actionable IS DISTINCT FROM TRUE
       OR OLD.lifecycle_state IS DISTINCT FROM 'ENTRY_READY'
     )
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
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_entry_ready_notification() FROM public;

DROP TRIGGER IF EXISTS enqueue_entry_ready_notification ON public.signals;
CREATE TRIGGER enqueue_entry_ready_notification
AFTER INSERT OR UPDATE OF is_actionable, lifecycle_state ON public.signals
FOR EACH ROW EXECUTE FUNCTION public.enqueue_entry_ready_notification();

-- Recover only current, still-actionable alerts. Historical/expired signals
-- are not queued and an existing in-app notification is never duplicated.
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

DO $block$
DECLARE
  template_command text;
  existing record;
BEGIN
  -- Context and precision are reporting in the affected deployment, so one of
  -- their commands is the authoritative source of the current host and auth
  -- header. Fail closed if no working P-Trades route can be found.
  SELECT job.command
  INTO template_command
  FROM cron.job job
  WHERE job.active IS TRUE
    AND job.command ~ '/api/public/hooks/(sync-market-data|scan-context|scan-precision|deliver-alerts)'
  ORDER BY
    CASE job.jobname
      WHEN 'ptrades-scan-context' THEN 0
      WHEN 'ptrades-scan-precision' THEN 1
      WHEN 'ptrades-sync-market-data' THEN 2
      WHEN 'ptrades-deliver-alerts' THEN 3
      ELSE 4
    END,
    job.jobid
  LIMIT 1;

  IF template_command IS NULL THEN
    RAISE EXCEPTION
      'P-Trades runtime recovery needs one existing authenticated hook job as its URL/auth template';
  END IF;

  -- Remove the rollback-era monolith and every duplicate split-pipeline job.
  FOR existing IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'ptrades-scan-markets',
      'ptrades-sync-market-data',
      'ptrades-scan-context',
      'ptrades-scan-precision',
      'ptrades-deliver-alerts'
    )
  LOOP
    PERFORM cron.unschedule(existing.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'ptrades-sync-market-data',
    '* * * * *',
    regexp_replace(
      template_command,
      '/api/public/hooks/(sync-market-data|scan-context|scan-precision|deliver-alerts)',
      '/api/public/hooks/sync-market-data',
      'g'
    )
  );

  PERFORM cron.schedule(
    'ptrades-scan-context',
    '1-59/3 * * * *',
    regexp_replace(
      template_command,
      '/api/public/hooks/(sync-market-data|scan-context|scan-precision|deliver-alerts)',
      '/api/public/hooks/scan-context',
      'g'
    )
  );

  PERFORM cron.schedule(
    'ptrades-scan-precision',
    '* * * * *',
    regexp_replace(
      template_command,
      '/api/public/hooks/(sync-market-data|scan-context|scan-precision|deliver-alerts)',
      '/api/public/hooks/scan-precision',
      'g'
    )
  );

  PERFORM cron.schedule(
    'ptrades-deliver-alerts',
    '* * * * *',
    regexp_replace(
      template_command,
      '/api/public/hooks/(sync-market-data|scan-context|scan-precision|deliver-alerts)',
      '/api/public/hooks/deliver-alerts',
      'g'
    )
  );
END;
$block$;

NOTIFY pgrst, 'reload schema';
