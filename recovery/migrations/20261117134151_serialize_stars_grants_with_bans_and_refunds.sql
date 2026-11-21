-- Serialize Stars grants against refund preparation and account-ban updates.
CREATE OR REPLACE FUNCTION public.prepare_flamexbot_star_refund(
  p_telegram_payment_charge_id text,
  p_user_id uuid,
  p_telegram_user_id text,
  p_invoice_payload text,
  p_payment_kind text,
  p_currency text,
  p_total_amount integer,
  p_provider_payment_charge_id text,
  p_reason text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_existing public.flamexbot_refunded_star_payments%rowtype;
BEGIN
  IF nullif(trim(coalesce(p_telegram_payment_charge_id,'')),'') IS NULL OR p_user_id IS NULL
     OR nullif(trim(coalesce(p_telegram_user_id,'')),'') IS NULL OR nullif(trim(coalesce(p_invoice_payload,'')),'') IS NULL
     OR p_payment_kind NOT IN ('premium','pro','wheel','command_protection') OR p_currency <> 'XTR'
     OR p_total_amount <= 0 OR nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Invalid refunded Stars payment record';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_telegram_payment_charge_id,0));
  INSERT INTO public.flamexbot_refunded_star_payments(
    telegram_payment_charge_id,user_id,telegram_user_id,invoice_payload,payment_kind,currency,total_amount,provider_payment_charge_id,reason
  ) VALUES (
    p_telegram_payment_charge_id,p_user_id,p_telegram_user_id,p_invoice_payload,p_payment_kind,p_currency,p_total_amount,p_provider_payment_charge_id,left(p_reason,500)
  ) ON CONFLICT (telegram_payment_charge_id) DO NOTHING;
  SELECT * INTO v_existing FROM public.flamexbot_refunded_star_payments
  WHERE telegram_payment_charge_id=p_telegram_payment_charge_id FOR UPDATE;
  IF v_existing.user_id IS DISTINCT FROM p_user_id OR v_existing.telegram_user_id IS DISTINCT FROM p_telegram_user_id
     OR v_existing.invoice_payload IS DISTINCT FROM p_invoice_payload OR v_existing.payment_kind IS DISTINCT FROM p_payment_kind
     OR v_existing.total_amount IS DISTINCT FROM p_total_amount THEN
    RAISE EXCEPTION 'Telegram payment charge id is already recorded for a different payment';
  END IF;
  RETURN v_existing.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_flamexbot_tier_payment(
  p_user_id uuid,p_telegram_user_id text,p_invoice_payload text,p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text,p_currency text,p_total_amount integer,p_period_days integer,p_plan text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
     OR nullif(trim(coalesce(p_invoice_payload,'')),'') IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid Telegram Stars subscription payment';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_telegram_payment_charge_id,0));
  PERFORM 1 FROM public.profiles p
  WHERE p.id=p_user_id AND p.telegram_id=p_telegram_user_id AND p.is_banned=false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription account is unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.flamexbot_refunded_star_payments r WHERE r.telegram_payment_charge_id=p_telegram_payment_charge_id) THEN
    RAISE EXCEPTION 'Telegram Stars payment has already been refunded or refund is pending';
  END IF;
  SELECT s.plan,s.expires_at INTO v_current_plan,v_current_expires
  FROM public.user_subscriptions s WHERE s.user_id=p_user_id FOR UPDATE;
  IF p_plan='premium' AND v_current_plan='pro' AND (v_current_expires IS NULL OR v_current_expires>v_now) THEN
    RAISE EXCEPTION 'Active PRO cannot be downgraded by a Premium payment';
  END IF;
  IF v_current_plan IN ('premium','pro') AND v_current_expires IS NULL THEN
    RAISE EXCEPTION 'Lifetime subscription is already active';
  END IF;
  INSERT INTO public.flamexbot_star_payments(
    user_id,telegram_user_id,invoice_payload,telegram_payment_charge_id,provider_payment_charge_id,currency,total_amount,period_days,plan
  ) VALUES (p_user_id,p_telegram_user_id,p_invoice_payload,p_telegram_payment_charge_id,p_provider_payment_charge_id,p_currency,p_total_amount,p_period_days,p_plan)
  ON CONFLICT(telegram_payment_charge_id) DO NOTHING RETURNING id INTO v_payment_id;
  IF v_payment_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.user_subscriptions(user_id,plan,starts_at,expires_at,granted_by,updated_at)
  VALUES(p_user_id,p_plan,v_now,v_now+make_interval(days=>p_period_days),null,v_now)
  ON CONFLICT(user_id) DO UPDATE
  SET plan=p_plan,
      starts_at=CASE WHEN public.user_subscriptions.expires_at>v_now THEN public.user_subscriptions.starts_at ELSE v_now END,
      expires_at=greatest(coalesce(public.user_subscriptions.expires_at,v_now),v_now)+make_interval(days=>p_period_days),
      granted_by=null,updated_at=v_now;
  INSERT INTO public.notifications(user_id,type,title,body,data)
  VALUES(p_user_id,'subscription_activated',
    CASE p_plan WHEN 'pro' THEN 'FLAMEX PRO активирован' ELSE 'Premium активирован' END,
    CASE p_plan WHEN 'pro' THEN 'Тебе открыт FLAMEX PRO на 30 дней: 2 еженедельные прокрутки и +10% к шансу редких наград.'
      ELSE 'Тебе открыт Premium на 30 дней: 1 бесплатная прокрутка каждую неделю.' END,
    jsonb_build_object('plan',p_plan,'period_days',p_period_days,'payment_charge_id',p_telegram_payment_charge_id));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_flamexbot_wheel_payment(
  p_invoice_payload text,p_telegram_user_id text,p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text,p_currency text,p_total_amount integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.flamexbot_wheel_orders%rowtype; v_prize jsonb;
BEGIN
  SELECT * INTO v_order FROM public.flamexbot_wheel_orders WHERE invoice_payload=p_invoice_payload FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wheel order not found'; END IF;
  IF v_order.telegram_user_id<>p_telegram_user_id OR p_currency<>'XTR'
     OR p_total_amount<>v_order.price_stars OR v_order.price_stars<>5
     OR nullif(trim(coalesce(p_telegram_payment_charge_id,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Wheel payment does not match the order';
  END IF;
  IF v_order.status='paid' THEN
    RETURN jsonb_build_object('applied',false,'prize_type',v_order.prize_type,'prize_code',v_order.prize_code,'prize_label',v_order.prize_label);
  END IF;
  IF v_order.status<>'pending' THEN RAISE EXCEPTION 'Wheel order is not payable'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_telegram_payment_charge_id,0));
  PERFORM 1 FROM public.profiles p
  WHERE p.id=v_order.user_id AND p.telegram_id=p_telegram_user_id AND p.is_banned=false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wheel account is unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.flamexbot_refunded_star_payments r WHERE r.telegram_payment_charge_id=p_telegram_payment_charge_id) THEN
    RAISE EXCEPTION 'Telegram Stars payment has already been refunded or refund is pending';
  END IF;
  v_prize:=public.draw_flamexbot_wheel_prize(v_order.user_id,null);
  UPDATE public.flamexbot_wheel_orders SET status='paid',prize_type=v_prize->>'prize_type',
    prize_code=v_prize->>'prize_code',prize_label=v_prize->>'prize_label',
    telegram_payment_charge_id=p_telegram_payment_charge_id,provider_payment_charge_id=p_provider_payment_charge_id,paid_at=now()
  WHERE id=v_order.id;
  INSERT INTO public.notifications(user_id,type,title,body,data)
  VALUES(v_order.user_id,'wheel_prize','Награда колеса фортуны',
    'Выпала награда: '||coalesce(v_prize->>'prize_label','Награда начислена')||'.',
    jsonb_build_object('prize_type',v_prize->>'prize_type','prize_code',v_prize->>'prize_code','wheel_order_id',v_order.id));
  RETURN v_prize||jsonb_build_object('applied',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_flamexbot_command_protection_payment(
  p_invoice_payload text,p_telegram_user_id text,p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text,p_currency text,p_total_amount integer
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.flamexbot_addon_star_payments%rowtype; v_expires_at timestamptz;
BEGIN
  IF p_currency<>'XTR' OR p_total_amount<>15
     OR nullif(trim(coalesce(p_telegram_payment_charge_id,'')),'') IS NULL
     OR nullif(trim(coalesce(p_telegram_user_id,'')),'') IS NULL
     OR nullif(trim(coalesce(p_invoice_payload,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Invalid command protection Telegram Stars payment';
  END IF;
  SELECT * INTO v_order FROM public.flamexbot_addon_star_payments WHERE invoice_payload=p_invoice_payload FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Command protection invoice was not found'; END IF;
  IF v_order.status='paid' THEN RETURN false; END IF;
  IF v_order.status<>'pending' THEN RAISE EXCEPTION 'Command protection invoice is not payable'; END IF;
  IF v_order.addon_code<>'command_protection' OR v_order.currency<>p_currency OR v_order.total_amount<>p_total_amount
     OR v_order.period_days<>5 OR v_order.telegram_user_id<>p_telegram_user_id THEN
    RAISE EXCEPTION 'Command protection invoice does not match the payment';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_telegram_payment_charge_id,0));
  IF EXISTS (SELECT 1 FROM public.flamexbot_refunded_star_payments r WHERE r.telegram_payment_charge_id=p_telegram_payment_charge_id) THEN
    RAISE EXCEPTION 'Telegram Stars payment has already been refunded or refund is pending';
  END IF;
  SELECT p.command_protection_expires_at INTO v_expires_at FROM public.profiles p
  WHERE p.id=v_order.user_id AND p.telegram_id=p_telegram_user_id AND p.is_banned=false FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Command protection account is unavailable'; END IF;
  UPDATE public.flamexbot_addon_star_payments
  SET status='paid',telegram_payment_charge_id=p_telegram_payment_charge_id,
      provider_payment_charge_id=p_provider_payment_charge_id,paid_at=now()
  WHERE id=v_order.id;
  UPDATE public.profiles
  SET command_protection_expires_at=greatest(coalesce(v_expires_at,now()),now())+interval '5 days',updated_at=now()
  WHERE id=v_order.user_id;
  RETURN true;
END;
$$;
