-- Speed up expiry cleanup of Telegram initData replay reservations.
CREATE INDEX IF NOT EXISTS telegram_init_data_uses_used_at_idx
  ON public.telegram_init_data_uses (used_at);
