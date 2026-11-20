-- Safe, additive migration: no existing rows or tables are removed.
CREATE INDEX IF NOT EXISTS flamexbot_burger_traps_profile_id_idx
  ON public.flamexbot_burger_traps (profile_id);

CREATE INDEX IF NOT EXISTS flamexbot_business_monitors_business_chat_id_idx
  ON public.flamexbot_business_monitors (business_chat_id);

CREATE INDEX IF NOT EXISTS flamexbot_premium_entitlement_ledger_user_id_idx
  ON public.flamexbot_premium_entitlement_ledger (user_id);

CREATE OR REPLACE FUNCTION public.admin_get_flamexbot_business_status(p_user_ids uuid[])
RETURNS TABLE (
  profile_id uuid,
  telegram_user_id text,
  is_enabled boolean,
  rights jsonb,
  connected_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_ids uuid[] := coalesce(p_user_ids, ARRAY[]::uuid[]);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_flamexbot_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING errcode = '42501';
  END IF;

  IF cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN bc.profile_id = ANY(v_ids) THEN bc.profile_id ELSE p.id END,
    bc.telegram_user_id,
    coalesce(bc.is_enabled, false),
    coalesce(bc.rights, '{}'::jsonb),
    bc.connected_at,
    bc.updated_at
  FROM public.flamexbot_business_connections AS bc
  LEFT JOIN public.profiles AS p
    ON p.telegram_id = bc.telegram_user_id
  WHERE bc.profile_id = ANY(v_ids)
     OR p.id = ANY(v_ids)
  ORDER BY 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_flamexbot_business_status(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_flamexbot_business_status(uuid[]) TO authenticated;
