CREATE OR REPLACE FUNCTION public.claim_flamexbot_telegram_notification_by_id(
  p_notification_id uuid,
  p_user_id uuid,
  p_claim_token uuid
)
RETURNS TABLE(notification_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_notification_id IS NULL OR p_user_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Notification id, user id and claim token are required';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT n.id
    FROM public.notifications AS n
    WHERE n.id = p_notification_id
      AND n.user_id = p_user_id
      AND n.telegram_delivered_at IS NULL
      AND (n.telegram_delivery_claimed_at IS NULL
        OR n.telegram_delivery_claimed_at < now() - interval '2 minutes')
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ),
  claimed AS (
    UPDATE public.notifications AS n
    SET telegram_delivery_claimed_at = now(),
        telegram_delivery_claim_token = p_claim_token
    FROM candidate AS c
    WHERE n.id = c.id
    RETURNING n.id
  )
  SELECT c.id FROM claimed AS c;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_flamexbot_telegram_notification_by_id(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_flamexbot_telegram_notification_by_id(uuid,uuid,uuid) TO service_role;
