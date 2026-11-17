CREATE UNIQUE INDEX IF NOT EXISTS flamexbot_wheel_orders_telegram_payment_charge_id_key
  ON public.flamexbot_wheel_orders (telegram_payment_charge_id)
  WHERE telegram_payment_charge_id IS NOT NULL;
