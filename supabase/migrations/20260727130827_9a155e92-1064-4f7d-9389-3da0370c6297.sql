
-- ROLES
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'trader');
CREATE TYPE public.signal_grade AS ENUM ('A_PLUS', 'A', 'B');
CREATE TYPE public.decision_type AS ENUM ('TAKEN', 'SKIPPED', 'EXPIRED', 'INVALIDATED');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles read" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('owner','admin'));
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'trader')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RULEBOOK
CREATE TABLE public.rulebook_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT false,
  summary TEXT,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rulebook_versions TO authenticated;
GRANT ALL ON public.rulebook_versions TO service_role;
ALTER TABLE public.rulebook_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rulebook read" ON public.rulebook_versions FOR SELECT TO authenticated USING (true);

-- SCANNER RUNS
CREATE TABLE public.scanner_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  symbols_scanned TEXT[] NOT NULL DEFAULT '{}',
  signals_emitted INTEGER NOT NULL DEFAULT 0,
  rejections JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  rulebook_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.scanner_runs TO authenticated;
GRANT ALL ON public.scanner_runs TO service_role;
ALTER TABLE public.scanner_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scanner runs staff read" ON public.scanner_runs FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- SIGNALS
CREATE TABLE public.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,
  instrument TEXT NOT NULL,
  broker_symbol TEXT,
  direction TEXT NOT NULL,
  setup_type TEXT,
  timeframe TEXT,
  entry_zone_low NUMERIC,
  entry_zone_high NUMERIC,
  stop_loss NUMERIC,
  targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  rr_tp1 NUMERIC,
  score NUMERIC,
  grade public.signal_grade,
  score_components JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejection_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalidation TEXT,
  macro_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  spread NUMERIC,
  is_actionable BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  rulebook_version TEXT,
  signal_time_utc TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at_utc TIMESTAMPTZ,
  trading_day_utc DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  scanner_run_id UUID REFERENCES public.scanner_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX signals_day_idx ON public.signals (trading_day_utc DESC);
CREATE INDEX signals_time_idx ON public.signals (signal_time_utc DESC);
GRANT SELECT ON public.signals TO authenticated;
GRANT ALL ON public.signals TO service_role;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signals read" ON public.signals FOR SELECT TO authenticated USING (true);

-- DECISIONS
CREATE TABLE public.signal_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  decision public.decision_type NOT NULL,
  note TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, signal_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_decisions TO authenticated;
GRANT ALL ON public.signal_decisions TO service_role;
ALTER TABLE public.signal_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own decisions" ON public.signal_decisions FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER signal_decisions_updated_at BEFORE UPDATE ON public.signal_decisions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- TRADES
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price NUMERIC,
  stop_price NUMERIC,
  exit_price NUMERIC,
  risk_amount NUMERIC,
  r_multiple NUMERIC,
  status TEXT NOT NULL DEFAULT 'OPEN',
  outcome TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trades TO authenticated;
GRANT ALL ON public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own trades" ON public.trades FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trades_updated_at BEFORE UPDATE ON public.trades
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- TRADE EVENTS
CREATE TABLE public.trade_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_events TO authenticated;
GRANT ALL ON public.trade_events TO service_role;
ALTER TABLE public.trade_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own trade events" ON public.trade_events FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- MACRO EVENTS
CREATE TABLE public.macro_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  currency TEXT,
  impact TEXT NOT NULL DEFAULT 'HIGH',
  event_time_utc TIMESTAMPTZ NOT NULL,
  lockout_start_utc TIMESTAMPTZ,
  lockout_end_utc TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.macro_events TO authenticated;
GRANT ALL ON public.macro_events TO service_role;
ALTER TABLE public.macro_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "macro events read" ON public.macro_events FOR SELECT TO authenticated USING (true);

-- HEARTBEATS
CREATE TABLE public.system_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  mt5_connected BOOLEAN,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  rulebook_version TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX heartbeats_received_idx ON public.system_heartbeats (received_at DESC);
GRANT SELECT ON public.system_heartbeats TO authenticated;
GRANT ALL ON public.system_heartbeats TO service_role;
ALTER TABLE public.system_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "heartbeats read" ON public.system_heartbeats FOR SELECT TO authenticated USING (true);

-- NOTIFICATIONS
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id UUID REFERENCES public.signals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own notifications update" ON public.notifications FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own notifications delete" ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);
