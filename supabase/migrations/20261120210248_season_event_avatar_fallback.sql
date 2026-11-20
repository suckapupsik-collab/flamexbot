-- Preserve Telegram profile photos in season-event winner cards when no custom avatar exists.
CREATE OR REPLACE FUNCTION public.get_flamexbot_season_event_leaderboard(
  p_event_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  rank_position bigint,
  display_name text,
  username text,
  avatar_url text,
  progress_at_claim integer,
  reward_xp integer,
  claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_flamexbot_user_active() THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.flamexbot_season_events e WHERE e.id = p_event_id) THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  RETURN QUERY
  SELECT
    row_number() OVER (ORDER BY c.progress_at_claim DESC, c.claimed_at ASC, c.user_id ASC),
    coalesce(p.display_name, 'Участник'),
    coalesce(nullif(p.telegram_username, ''), nullif(p.username, '')),
    coalesce(p.avatar_url, p.telegram_photo_url),
    c.progress_at_claim,
    c.reward_xp,
    c.claimed_at
  FROM public.flamexbot_season_event_claims c
  JOIN public.profiles p ON p.id = c.user_id
  WHERE c.event_id = p_event_id
  ORDER BY c.progress_at_claim DESC, c.claimed_at ASC, c.user_id ASC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 100));
END;
$function$;
