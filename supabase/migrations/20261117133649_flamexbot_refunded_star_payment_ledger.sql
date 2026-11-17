CREATE TABLE IF NOT EXISTS public.flamexbot_refunded_star_payments (
  telegram_payment_charge_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  telegram_user_id text NOT NULL,
  invoice_payload text NOT NULL,
  payment_kind text NOT NULL CHECK (payment_kind IN ('premium','pro','wheel','command_protection')),
  currency text NOT NULL CHECK (currency='XTR'),
  total_amount integer NOT NULL CHECK (total_amount>0),
  provider_payment_charge_id text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'refund_pending' CHECK (status IN ('refund_pending','refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  refunded_at timestamptz
);

ALTER TABLE public.flamexbot_refunded_star_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.flamexbot_refunded_star_payments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.flamexbot_refunded_star_payments TO service_role;

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
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing public.flamexbot_refunded_star_payments%rowtype;
BEGIN
  IF nullif(trim(coalesce(p_telegram_payment_charge_id,'')),'') IS NULL
     OR p_user_id IS NULL
     OR nullif(trim(coalesce(p_telegram_user_id,'')),'') IS NULL
     OR nullif(trim(coalesce(p_invoice_payload,'')),'') IS NULL
     OR p_payment_kind NOT IN ('premium','pro','wheel','command_protection')
     OR p_currency <> 'XTR'
     OR p_total_amount <= 0
     OR nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Invalid refunded Stars payment record';
  END IF;

  INSERT INTO public.flamexbot_refunded_star_payments(
    telegram_payment_charge_id,user_id,telegram_user_id,invoice_payload,
    payment_kind,currency,total_amount,provider_payment_charge_id,reason
  ) VALUES (
    p_telegram_payment_charge_id,p_user_id,p_telegram_user_id,p_invoice_payload,
    p_payment_kind,p_currency,p_total_amount,p_provider_payment_charge_id,left(p_reason,500)
  ) ON CONFLICT (telegram_payment_charge_id) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.flamexbot_refunded_star_payments
  WHERE telegram_payment_charge_id=p_telegram_payment_charge_id
  FOR UPDATE;

  IF v_existing.user_id IS DISTINCT FROM p_user_id
     OR v_existing.telegram_user_id IS DISTINCT FROM p_telegram_user_id
     OR v_existing.invoice_payload IS DISTINCT FROM p_invoice_payload
     OR v_existing.payment_kind IS DISTINCT FROM p_payment_kind
     OR v_existing.total_amount IS DISTINCT FROM p_total_amount THEN
    RAISE EXCEPTION 'Telegram payment charge id is already recorded for a different payment';
  END IF;

  RETURN v_existing.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_flamexbot_star_refund(p_telegram_payment_charge_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.flamexbot_refunded_star_payments
  SET status='refunded',refunded_at=coalesce(refunded_at,now())
  WHERE telegram_payment_charge_id=p_telegram_payment_charge_id
    AND status IN ('refund_pending','refunded');
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_flamexbot_star_refund_status(p_telegram_payment_charge_id text)
RETURNS TABLE(status text,invoice_payload text,user_id uuid,telegram_user_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.status,r.invoice_payload,r.user_id,r.telegram_user_id
  FROM public.flamexbot_refunded_star_payments r
  WHERE r.telegram_payment_charge_id=p_telegram_payment_charge_id;
$$;

REVOKE ALL ON FUNCTION public.prepare_flamexbot_star_refund(text,uuid,text,text,text,text,integer,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_flamexbot_star_refund(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_flamexbot_star_refund_status(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_flamexbot_star_refund(text,uuid,text,text,text,text,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_flamexbot_star_refund(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_flamexbot_star_refund_status(text) TO service_role;
