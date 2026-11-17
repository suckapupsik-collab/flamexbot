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
        'pro_granted','pro_revoked','badge_granted','badge_revoked',
        'business_connected','business_disconnected'
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
