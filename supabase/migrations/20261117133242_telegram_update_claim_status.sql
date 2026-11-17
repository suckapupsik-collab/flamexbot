-- Distinguish completed webhook retries from updates that are still processing.
-- A duplicate in-flight delivery must not be acknowledged as completed.

CREATE OR REPLACE FUNCTION public.claim_flamexbot_telegram_update_v2(p_update_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claimed bigint;
  v_status text;
BEGIN
  IF p_update_id IS NULL OR p_update_id < 0 THEN
    RETURN 'invalid';
  END IF;

  INSERT INTO public.flamexbot_telegram_updates(update_id,status,attempts,created_at,updated_at)
  VALUES(p_update_id,'processing',1,now(),now())
  ON CONFLICT(update_id) DO UPDATE
    SET status='processing',
        attempts=public.flamexbot_telegram_updates.attempts+1,
        last_error=NULL,
        updated_at=now()
    WHERE public.flamexbot_telegram_updates.status='failed'
       OR (
         public.flamexbot_telegram_updates.status='processing'
         AND public.flamexbot_telegram_updates.updated_at < now()-interval '2 minutes'
       )
  RETURNING update_id INTO v_claimed;

  IF v_claimed IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT status INTO v_status
  FROM public.flamexbot_telegram_updates
  WHERE update_id=p_update_id;

  IF v_status='completed' THEN
    RETURN 'completed';
  ELSIF v_status='processing' THEN
    RETURN 'processing';
  END IF;

  RETURN 'retry';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_flamexbot_telegram_update_v2(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_flamexbot_telegram_update_v2(bigint) TO service_role;
