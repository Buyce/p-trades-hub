-- 1. Admin helper
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('owner','admin')
  );
$$;

-- 2. scanner_errors
CREATE TABLE public.scanner_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanner_run_id uuid,
  instrument text,
  stage text NOT NULL,
  error_code text NOT NULL,
  message text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.scanner_errors TO authenticated;
GRANT ALL ON public.scanner_errors TO service_role;
ALTER TABLE public.scanner_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scanner errors staff read" ON public.scanner_errors
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE INDEX scanner_errors_run_idx ON public.scanner_errors (scanner_run_id);
CREATE INDEX scanner_errors_time_idx ON public.scanner_errors (occurred_at DESC);

-- 3. audit_log
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_kind text NOT NULL DEFAULT 'SYSTEM',
  action text NOT NULL,
  entity_type text,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_actor_kind_chk CHECK (actor_kind IN ('SYSTEM','USER','SCANNER'))
);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit log staff read" ON public.audit_log
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE INDEX audit_log_time_idx ON public.audit_log (created_at DESC);

-- 4. Signal integrity constraints
CREATE UNIQUE INDEX IF NOT EXISTS signals_fingerprint_uidx
  ON public.signals (fingerprint) WHERE fingerprint IS NOT NULL;

ALTER TABLE public.signals
  ADD CONSTRAINT signals_direction_chk CHECK (direction IN ('LONG','SHORT')) NOT VALID,
  ADD CONSTRAINT signals_status_chk
    CHECK (status IN ('ACTIVE','EXPIRED','INVALIDATED','TRIGGERED','CLOSED','CANCELLED')) NOT VALID,
  ADD CONSTRAINT signals_score_range_chk
    CHECK (score IS NULL OR (score >= 0 AND score <= 100)) NOT VALID;

ALTER TABLE public.signal_candidates
  ADD CONSTRAINT signal_candidates_direction_chk
    CHECK (direction IS NULL OR direction IN ('LONG','SHORT')) NOT VALID,
  ADD CONSTRAINT signal_candidates_score_range_chk
    CHECK (score IS NULL OR (score >= 0 AND score <= 100)) NOT VALID,
  ADD CONSTRAINT signal_candidates_qualified_grade_chk
    CHECK (qualified = false OR grade IN ('A_PLUS','A')) NOT VALID;

-- 5. Trade journal fields
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS planned_entry numeric,
  ADD COLUMN IF NOT EXISTS actual_entry numeric,
  ADD COLUMN IF NOT EXISTS planned_stop numeric,
  ADD COLUMN IF NOT EXISTS actual_stop numeric,
  ADD COLUMN IF NOT EXISTS partial_exits jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS result_cash numeric,
  ADD COLUMN IF NOT EXISTS followed_plan boolean,
  ADD COLUMN IF NOT EXISTS mistake_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS mae_r numeric,
  ADD COLUMN IF NOT EXISTS mfe_r numeric,
  ADD COLUMN IF NOT EXISTS setup_type text,
  ADD COLUMN IF NOT EXISTS grade signal_grade,
  ADD COLUMN IF NOT EXISTS session text;

ALTER TABLE public.trades
  ADD CONSTRAINT trades_direction_chk CHECK (direction IN ('LONG','SHORT')) NOT VALID,
  ADD CONSTRAINT trades_status_chk CHECK (status IN ('OPEN','CLOSED','CANCELLED')) NOT VALID,
  ADD CONSTRAINT trades_outcome_chk
    CHECK (outcome IS NULL OR outcome IN ('WIN','LOSS','BREAKEVEN','PARTIAL')) NOT VALID;

-- 6. Trade event vocabulary
ALTER TABLE public.trade_events
  ADD CONSTRAINT trade_events_type_chk
    CHECK (event_type IN ('ENTRY','STOP_MOVE','PARTIAL_EXIT','TARGET_HIT','MANUAL_EXIT','STOP_HIT','CANCELLED')) NOT VALID;