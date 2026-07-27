CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  note text,
  role public.app_role NOT NULL DEFAULT 'trader',
  status text NOT NULL DEFAULT 'PENDING',
  invited_by uuid,
  invited_user_id uuid,
  accepted_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT invites_status_check CHECK (status IN ('PENDING','ACCEPTED','REVOKED'))
);

CREATE UNIQUE INDEX invites_pending_email_uniq
  ON public.invites (lower(email))
  WHERE status = 'PENDING';

CREATE INDEX invites_created_at_idx ON public.invites (created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invites staff read"
  ON public.invites FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "invites staff insert"
  ON public.invites FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()) AND invited_by = auth.uid());

CREATE POLICY "invites staff update"
  ON public.invites FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER update_invites_updated_at
  BEFORE UPDATE ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();