-- Cover the business_chat_id foreign key used by cascade deletes and chat-scoped lookups.
CREATE INDEX IF NOT EXISTS flamexbot_business_send_limits_business_chat_id_idx
  ON public.flamexbot_business_send_limits (business_chat_id);
