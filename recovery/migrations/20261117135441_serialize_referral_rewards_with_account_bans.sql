CREATE OR REPLACE FUNCTION public.apply_flamexbot_referral(
  p_referrer_id uuid,
  p_referred_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_referrer_plan text;
  v_referrer_expires timestamptz;
  v_lifetime boolean := false;
BEGIN
  IF p_referrer_id IS NULL OR p_referred_user_id IS NULL OR p_referrer_id = p_referred_user_id THEN
    RETURN false;
  END IF;

  PERFORM p.id
  FROM public.profiles p
  WHERE p.id IN (p_referrer_id, p_referred_user_id)
  ORDER BY p.id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_referred_user_id AND p.telegram_id IS NOT NULL AND p.is_banned = false
  ) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_referrer_id AND p.is_banned = false
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.flamexbot_referrals(referrer_id, referred_user_id)
  VALUES (p_referrer_id, p_referred_user_id)
  ON CONFLICT(referred_user_id) DO NOTHING;

  IF NOT FOUND THEN RETURN false; END IF;

  SELECT s.plan, s.expires_at INTO v_referrer_plan, v_referrer_expires
  FROM public.user_subscriptions s
  WHERE s.user_id = p_referrer_id
  FOR UPDATE;

  v_lifetime := FOUND
    AND v_referrer_plan IN ('premium','pro')
    AND v_referrer_expires IS NULL;

  IF v_lifetime THEN
    UPDATE public.profiles
    SET wheel_free_spins = wheel_free_spins + 1, updated_at = now()
    WHERE id = p_referrer_id;
  ELSE
    INSERT INTO public.user_subscriptions(user_id, plan, starts_at, expires_at, granted_by, updated_at)
    VALUES (p_referrer_id, 'premium', now(), now() + interval '1 day', p_referrer_id, now())
    ON CONFLICT(user_id) DO UPDATE
    SET plan = CASE WHEN public.user_subscriptions.plan = 'pro' THEN 'pro' ELSE 'premium' END,
        expires_at = greatest(coalesce(public.user_subscriptions.expires_at, now()), now()) + interval '1 day',
        updated_at = now();
  END IF;

  INSERT INTO public.notifications(user_id, type, title, body, data)
  VALUES (
    p_referrer_id, 'referral_reward', 'Реферальная награда',
    CASE WHEN v_lifetime
      THEN 'За приглашённого участника начислена бесплатная прокрутка: бессрочный тариф уже активен.'
      ELSE 'За приглашённого участника начислен 1 день Premium.'
    END,
    jsonb_build_object(
      'referred_user_id', p_referred_user_id,
      'reward_days', CASE WHEN v_lifetime THEN 0 ELSE 1 END,
      'bonus_spin', v_lifetime
    )
  );

  RETURN true;
END;
$$;
