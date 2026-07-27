CREATE UNIQUE INDEX IF NOT EXISTS signals_external_id_key
  ON public.signals (external_id)
  WHERE external_id IS NOT NULL;