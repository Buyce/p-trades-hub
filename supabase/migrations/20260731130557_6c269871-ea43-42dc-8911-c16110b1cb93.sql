CREATE UNIQUE INDEX rulebook_versions_one_active_idx
ON public.rulebook_versions ((is_active))
WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.validate_rulebook_activation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active AND upper(NEW.status) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'An active rulebook must have ACTIVE status';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_rulebook_activation_before_write
BEFORE INSERT OR UPDATE OF is_active, status
ON public.rulebook_versions
FOR EACH ROW
EXECUTE FUNCTION public.validate_rulebook_activation();