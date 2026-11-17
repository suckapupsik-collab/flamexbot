-- Business message events are written by trusted server-side webhook handlers.
-- Authenticated clients only need read access; RLS limits reads to the owner's events.
REVOKE ALL ON TABLE public.flamexbot_business_message_events FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.flamexbot_business_message_events
  FROM authenticated;
GRANT SELECT ON TABLE public.flamexbot_business_message_events TO authenticated;
