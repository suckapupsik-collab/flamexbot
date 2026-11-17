CREATE OR REPLACE FUNCTION public.claim_flamexbot_trial()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile_id uuid;
  v_current_plan text;
  v_current_expires timestamptz;
  v_exp timestamptz;
  v_now timestamptz := now();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT p.id INTO v_profile_id
  FROM public.profiles p
  WHERE p.id = v_user AND p.is_banned = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account is banned or unavailable'; END IF;

  SELECT s.plan, s.expires_at INTO v_current_plan, v_current_expires
  FROM public.user_subscriptions s
  WHERE s.user_id = v_user
  FOR UPDATE;

  IF v_current_plan IN ('premium','pro')
     AND (v_current_expires IS NULL OR v_current_expires > v_now) THEN
    RAISE EXCEPTION 'An active subscription already exists';
  END IF;

  IF EXISTS (SELECT 1 FROM public.flamexbot_trials t WHERE t.user_id = v_user) THEN
    RAISE EXCEPTION 'Trial has already been used';
  END IF;

  v_exp := v_now + interval '3 days';
  INSERT INTO public.flamexbot_trials(user_id, expires_at) VALUES (v_user, v_exp);

  INSERT INTO public.user_subscriptions(user_id, plan, starts_at, expires_at, granted_by, updated_at)
  VALUES (v_user, 'premium', v_now, v_exp, v_user, v_now)
  ON CONFLICT(user_id) DO UPDATE
  SET plan = 'premium', starts_at = v_now, expires_at = v_exp,
      granted_by = v_user, updated_at = v_now;

  INSERT INTO public.notifications(user_id, type, title, body, data)
  VALUES (v_user, 'trial_activated', 'Пробный Premium активирован',
    'Тебе открыт Premium на 3 дня.', jsonb_build_object('expires_at', v_exp));

  RETURN v_exp;
END;
$$;
