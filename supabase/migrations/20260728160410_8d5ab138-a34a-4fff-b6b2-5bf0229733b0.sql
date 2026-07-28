ALTER TABLE public.profiles
  ALTER COLUMN alert_tiers_email SET DEFAULT ARRAY['A_PLUS','A','B','C']::text[],
  ALTER COLUMN alert_tiers_push SET DEFAULT ARRAY['A_PLUS','A','B','C']::text[],
  ALTER COLUMN alert_tiers_terminal SET DEFAULT ARRAY['A_PLUS','A','B','C']::text[];