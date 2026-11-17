ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS telegram_delivery_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_delivery_claim_token uuid;

CREATE INDEX IF NOT EXISTS notifications_telegram_delivery_pending_idx
  ON public.notifications (user_id, created_at)
  WHERE telegram_delivered_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_flamexbot_telegram_notifications(
  p_user_id uuid,
  p_claim_token uuid,
  p_limit integer DEFAULT 8
)
RETURNS TABLE(notification_id uuid, title text, body text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'User and claim token are required';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT n.id, n.created_at
    FROM public.notifications AS n
    WHERE n.user_id = p_user_id
      AND n.telegram_delivered_at IS NULL
      AND n.type = ANY (ARRAY[
        'weekly_wheel_spins','subscription_activated','wheel_prize',
        'referral_reward','trial_activated','account_banned','account_unbanned',
        'verified','unverified','premium_granted','premium_revoked',
        'pro_granted','pro_revoked','badge_granted','badge_revoked'
      ]::text[])
      AND (n.telegram_delivery_claimed_at IS NULL
        OR n.telegram_delivery_claimed_at < now() - interval '2 minutes')
    ORDER BY n.created_at, n.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20)
  ),
  claimed AS (
    UPDATE public.notifications AS n
    SET telegram_delivery_claimed_at = now(),
        telegram_delivery_claim_token = p_claim_token
    FROM candidates AS c
    WHERE n.id = c.id
    RETURNING n.id, n.title, n.body, n.created_at
  )
  SELECT c.id, c.title, c.body
  FROM claimed AS c
  ORDER BY c.created_at, c.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_flamexbot_telegram_notification_delivered(
  p_notification_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.notifications
  SET telegram_delivered_at = now(),
      telegram_delivery_claimed_at = NULL,
      telegram_delivery_claim_token = NULL
  WHERE id = p_notification_id
    AND telegram_delivered_at IS NULL
    AND telegram_delivery_claim_token = p_claim_token;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_flamexbot_telegram_notification_claims(
  p_claim_token uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_released integer;
BEGIN
  UPDATE public.notifications
  SET telegram_delivery_claimed_at = NULL,
      telegram_delivery_claim_token = NULL
  WHERE telegram_delivery_claim_token = p_claim_token
    AND telegram_delivered_at IS NULL;
  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN v_released;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_flamexbot_telegram_notifications(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_flamexbot_telegram_notification_delivered(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_flamexbot_telegram_notification_claims(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_flamexbot_telegram_notifications(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_flamexbot_telegram_notification_delivered(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_flamexbot_telegram_notification_claims(uuid) TO service_role;
