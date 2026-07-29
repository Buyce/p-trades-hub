UPDATE public.rulebook_versions SET is_active = false WHERE is_active = true AND version <> 'v1.8.0-live';

UPDATE public.rulebook_versions SET is_active = true WHERE version = 'v1.8.0-live';

INSERT INTO public.audit_log (actor_kind, action, entity_type, detail)
VALUES ('SYSTEM', 'RULEBOOK_ROLLBACK', 'rulebook_versions',
        jsonb_build_object('from', 'v2.1.0-live', 'to', 'v1.8.0-live', 'reason', 'User-requested revert to v1.8.0'));