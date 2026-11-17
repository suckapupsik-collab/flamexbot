-- Keep the original pending-notification index and remove the exact duplicate.
DROP INDEX IF EXISTS public.notifications_telegram_delivery_pending_idx;

-- Support user-scoped refund audit queries and FK maintenance.
CREATE INDEX IF NOT EXISTS flamexbot_refunded_star_payments_user_id_idx
  ON public.flamexbot_refunded_star_payments(user_id);
