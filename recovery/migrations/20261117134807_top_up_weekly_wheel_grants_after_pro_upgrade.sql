CREATE OR REPLACE FUNCTION public.grant_flamexbot_weekly_wheel_spins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_week_start date := date_trunc('week', now() at time zone 'UTC')::date;
  v_now timestamptz := now();
  v_user_id uuid;
  v_profile_id uuid;
  v_plan text;
  v_expires_at timestamptz;
  v_target_spins integer;
  v_previous_spins integer;
  v_delta integer;
  v_total integer := 0;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT s.user_id
    FROM public.user_subscriptions s
    WHERE s.plan IN ('premium','pro')
      AND (s.expires_at IS NULL OR s.expires_at > v_now)
    ORDER BY s.user_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user_id::text || ':' || v_week_start::text, 0)
    );

    SELECT p.id INTO v_profile_id
    FROM public.profiles p
    WHERE p.id = v_user_id AND p.is_banned = false
    FOR UPDATE;

    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT s.plan, s.expires_at INTO v_plan, v_expires_at
    FROM public.user_subscriptions s
    WHERE s.user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND OR v_plan NOT IN ('premium','pro')
       OR (v_expires_at IS NOT NULL AND v_expires_at <= v_now) THEN
      CONTINUE;
    END IF;

    v_target_spins := CASE v_plan WHEN 'pro' THEN 2 ELSE 1 END;
    SELECT g.granted_spins INTO v_previous_spins
    FROM public.flamexbot_weekly_wheel_grants g
    WHERE g.user_id = v_user_id AND g.week_start = v_week_start
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.flamexbot_weekly_wheel_grants(user_id, week_start, plan, granted_spins)
      VALUES (v_user_id, v_week_start, v_plan, v_target_spins);
      v_delta := v_target_spins;
    ELSIF v_target_spins > v_previous_spins THEN
      UPDATE public.flamexbot_weekly_wheel_grants
      SET plan = v_plan, granted_spins = v_target_spins
      WHERE user_id = v_user_id AND week_start = v_week_start;
      v_delta := v_target_spins - v_previous_spins;
    ELSE
      CONTINUE;
    END IF;

    UPDATE public.profiles
    SET wheel_free_spins = wheel_free_spins + v_delta, updated_at = v_now
    WHERE id = v_user_id;

    INSERT INTO public.notifications(user_id, type, title, body, data)
    VALUES (
      v_user_id, 'weekly_wheel_spins', 'Еженедельные прокрутки начислены',
      CASE
        WHEN v_delta = 2 THEN 'Тариф PRO: начислено 2 бесплатные прокрутки колеса.'
        WHEN v_delta = 1 AND v_target_spins = 2 THEN 'Тариф PRO: начислена дополнительная прокрутка после перехода на PRO.'
        ELSE 'Тариф Premium: начислена 1 бесплатная прокрутка колеса.'
      END,
      jsonb_build_object('week_start', v_week_start, 'plan', v_plan,
        'spins', v_delta, 'total_weekly_spins', v_target_spins)
    );

    v_total := v_total + v_delta;
  END LOOP;
  RETURN v_total;
END;
$$;
