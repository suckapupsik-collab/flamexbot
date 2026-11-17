CREATE TABLE IF NOT EXISTS public.flamexbot_business_send_limits (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_chat_id uuid NOT NULL REFERENCES public.flamexbot_business_chats(id) ON DELETE CASCADE,
  short_window_started_at timestamptz NOT NULL DEFAULT now(),
  short_send_count integer NOT NULL DEFAULT 0 CHECK (short_send_count >= 0),
  minute_window_started_at timestamptz NOT NULL DEFAULT now(),
  minute_send_count integer NOT NULL DEFAULT 0 CHECK (minute_send_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, business_chat_id)
);

ALTER TABLE public.flamexbot_business_send_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.flamexbot_business_send_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.flamexbot_business_send_limits TO service_role;

CREATE OR REPLACE FUNCTION public.flamexbot_consume_business_send_limit(
  p_profile_id uuid,
  p_business_chat_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_short_started timestamptz;
  v_short_count integer;
  v_minute_started timestamptz;
  v_minute_count integer;
  v_retry_short integer := 0;
  v_retry_minute integer := 0;
BEGIN
  IF p_profile_id IS NULL OR p_business_chat_id IS NULL THEN
    RAISE EXCEPTION 'Profile and business chat are required';
  END IF;

  INSERT INTO public.flamexbot_business_send_limits AS current_limit (
    profile_id, business_chat_id,
    short_window_started_at, short_send_count,
    minute_window_started_at, minute_send_count, updated_at
  )
  VALUES (p_profile_id, p_business_chat_id, v_now, 1, v_now, 1, v_now)
  ON CONFLICT (profile_id, business_chat_id) DO UPDATE SET
    short_window_started_at = CASE
      WHEN current_limit.short_window_started_at <= v_now - interval '10 seconds'
      THEN v_now ELSE current_limit.short_window_started_at END,
    short_send_count = CASE
      WHEN current_limit.short_window_started_at <= v_now - interval '10 seconds'
      THEN 1 ELSE current_limit.short_send_count + 1 END,
    minute_window_started_at = CASE
      WHEN current_limit.minute_window_started_at <= v_now - interval '1 minute'
      THEN v_now ELSE current_limit.minute_window_started_at END,
    minute_send_count = CASE
      WHEN current_limit.minute_window_started_at <= v_now - interval '1 minute'
      THEN 1 ELSE current_limit.minute_send_count + 1 END,
    updated_at = v_now
  RETURNING short_window_started_at, short_send_count,
            minute_window_started_at, minute_send_count
  INTO v_short_started, v_short_count, v_minute_started, v_minute_count;

  IF v_short_count > 8 THEN
    v_retry_short := greatest(1, ceil(extract(epoch FROM (v_short_started + interval '10 seconds' - v_now)))::integer);
  END IF;
  IF v_minute_count > 40 THEN
    v_retry_minute := greatest(1, ceil(extract(epoch FROM (v_minute_started + interval '1 minute' - v_now)))::integer);
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_short_count <= 8 AND v_minute_count <= 40,
    'retry_after', greatest(v_retry_short, v_retry_minute),
    'short_count', v_short_count,
    'minute_count', v_minute_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.flamexbot_consume_business_send_limit(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flamexbot_consume_business_send_limit(uuid, uuid)
  TO service_role;
