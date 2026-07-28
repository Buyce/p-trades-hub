ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_alerts_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read_at, created_at DESC);