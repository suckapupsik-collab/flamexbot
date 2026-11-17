-- Restrict trigger-only SECURITY DEFINER routines from direct API/RPC execution.
-- PostgreSQL triggers continue to invoke these functions through their attached triggers.
REVOKE EXECUTE ON FUNCTION public.apply_pending_flamexbot_referral() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.keep_flamexbot_founder_subscription() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.keep_flamexbot_owner_max_subscription() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_flamexbot_admin_action() FROM PUBLIC, anon, authenticated;

-- Cover the two foreign keys reported by the Supabase performance advisor.
CREATE INDEX IF NOT EXISTS flamexbot_business_flood_windows_business_chat_id_idx
  ON public.flamexbot_business_flood_windows (business_chat_id);
CREATE INDEX IF NOT EXISTS flamexbot_business_spam_consents_business_chat_id_idx
  ON public.flamexbot_business_spam_consents (business_chat_id);
