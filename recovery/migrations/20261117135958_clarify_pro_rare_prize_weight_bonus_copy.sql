CREATE OR REPLACE FUNCTION public.apply_flamexbot_tier_payment(
  p_user_id uuid,
  p_telegram_user_id text,
  p_invoice_payload text,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text,
  p_currency text,
  p_total_amount integer,
  p_period_days integer,
  p_plan text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment_id uuid;
  v_now timestamptz := now();
  v_expected_amount integer;
  v_current_plan text;
  v_current_expires timestamptz;
BEGIN
  IF p_plan NOT IN ('premium','pro') THEN RAISE EXCEPTION 'Unknown FLAMEXBOT tariff'; END IF;
  v_expected_amount := CASE p_plan WHEN 'pro' THEN 250 ELSE 100 END;
  IF p_currency <> 'XTR' OR p_total_amount <> v_expected_amount OR p_period_days <> 30
     OR nullif(trim(coalesce(p_telegram_payment_charge_id,'')),'') IS NULL
     OR nullif(trim(coalesce(p_telegram_user_id,'')),'') IS NULL
     OR nullif(trim(coalesce(p_invoice_payload,'')),'') IS NULL
     OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid Telegram Stars subscription payment';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_telegram_payment_charge_id,0));

  PERFORM 1 FROM public.profiles p
  WHERE p.id=p_user_id AND p.telegram_id=p_telegram_user_id AND p.is_banned=false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription account is unavailable'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.flamexbot_refunded_star_payments r
    WHERE r.telegram_payment_charge_id=p_telegram_payment_charge_id
  ) THEN
    RAISE EXCEPTION 'Telegram Stars payment has already been refunded or refund is pending';
  END IF;

  SELECT s.plan,s.expires_at INTO v_current_plan,v_current_expires
  FROM public.user_subscriptions s WHERE s.user_id=p_user_id FOR UPDATE;

  IF p_plan='premium' AND v_current_plan='pro'
     AND (v_current_expires IS NULL OR v_current_expires>v_now) THEN
    RAISE EXCEPTION 'Active PRO cannot be downgraded by a Premium payment';
  END IF;
  IF v_current_plan IN ('premium','pro') AND v_current_expires IS NULL THEN
    RAISE EXCEPTION 'Lifetime subscription is already active';
  END IF;

  INSERT INTO public.flamexbot_star_payments(
    user_id,telegram_user_id,invoice_payload,telegram_payment_charge_id,
    provider_payment_charge_id,currency,total_amount,period_days,plan
  ) VALUES (
    p_user_id,p_telegram_user_id,p_invoice_payload,p_telegram_payment_charge_id,
    p_provider_payment_charge_id,p_currency,p_total_amount,p_period_days,p_plan
  )
  ON CONFLICT(telegram_payment_charge_id) DO NOTHING
  RETURNING id INTO v_payment_id;

  IF v_payment_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.user_subscriptions(user_id,plan,starts_at,expires_at,granted_by,updated_at)
  VALUES(p_user_id,p_plan,v_now,v_now+make_interval(days=>p_period_days),null,v_now)
  ON CONFLICT(user_id) DO UPDATE
  SET plan=p_plan,
      starts_at=CASE WHEN public.user_subscriptions.expires_at>v_now
        THEN public.user_subscriptions.starts_at ELSE v_now END,
      expires_at=greatest(coalesce(public.user_subscriptions.expires_at,v_now),v_now)+make_interval(days=>p_period_days),
      granted_by=null,updated_at=v_now;

  INSERT INTO public.notifications(user_id,type,title,body,data)
  VALUES(
    p_user_id,'subscription_activated',
    CASE p_plan WHEN 'pro' THEN 'FLAMEX PRO активирован' ELSE 'Premium активирован' END,
    CASE p_plan
      WHEN 'pro' THEN 'Тебе открыт FLAMEX PRO на 30 дней: 2 еженедельные прокрутки и +10% к весам редких наград колеса.'
      ELSE 'Тебе открыт Premium на 30 дней: 1 бесплатная прокрутка каждую неделю.'
    END,
    jsonb_build_object('plan',p_plan,'period_days',p_period_days,'payment_charge_id',p_telegram_payment_charge_id)
  );
  RETURN true;
END;
$$;
