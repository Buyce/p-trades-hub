CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_outbox_ready_idx
  ON public.notification_outbox (status, available_at);
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_signal_idx
  ON public.notification_outbox (signal_id);

GRANT ALL ON public.notification_outbox TO service_role;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.precision_watches
  ADD COLUMN IF NOT EXISTS arming_zone_low double precision,
  ADD COLUMN IF NOT EXISTS arming_zone_high double precision;