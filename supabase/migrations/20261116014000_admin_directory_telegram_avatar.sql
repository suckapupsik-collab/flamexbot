-- Show the Telegram profile photo when no custom avatar is set in the admin directory.
create or replace function public.admin_list_flamexbot_users(
  p_search text default null,p_verified text default 'all',p_premium text default 'all',
  p_banned text default 'all',p_limit integer default 50,p_offset integer default 0
)
returns table(
  id uuid,username text,display_name text,telegram_username text,telegram_id text,
  avatar_url text,created_at timestamptz,is_banned boolean,ban_reason text,
  is_verified boolean,is_premium boolean,premium_expires_at timestamptz,
  badge_codes text[],total_count bigint
)
language plpgsql security definer set search_path=''
as $$
begin
  if not public.is_flamexbot_admin() then raise exception 'Administrator access required'; end if;
  return query
  select p.id,p.username,p.display_name,p.telegram_username,p.telegram_id,coalesce(p.avatar_url,p.telegram_photo_url),p.created_at,
    p.is_banned,p.ban_reason,
    exists(select 1 from public.profile_badges b where b.user_id=p.id and b.badge_code='verified'),
    exists(select 1 from public.user_subscriptions s where s.user_id=p.id and s.plan='premium' and (s.expires_at is null or s.expires_at>now())),
    (select s.expires_at from public.user_subscriptions s where s.user_id=p.id and s.plan='premium' and (s.expires_at is null or s.expires_at>now()) limit 1),
    coalesce((select array_agg(b.badge_code order by b.created_at) from public.profile_badges b where b.user_id=p.id),'{}'::text[]),
    count(*) over()
  from public.profiles p
  where (
      nullif(trim(coalesce(p_search,'')),'') is null
      or p.username ilike '%'||trim(p_search)||'%'
      or p.display_name ilike '%'||trim(p_search)||'%'
      or coalesce(p.telegram_username,'') ilike '%'||trim(p_search)||'%'
      or coalesce(p.telegram_id,'') ilike '%'||trim(p_search)||'%'
    )
    and (coalesce(p_verified,'all')='all'
      or (p_verified='verified' and exists(select 1 from public.profile_badges b where b.user_id=p.id and b.badge_code='verified'))
      or (p_verified='unverified' and not exists(select 1 from public.profile_badges b where b.user_id=p.id and b.badge_code='verified')))
    and (coalesce(p_premium,'all')='all'
      or (p_premium='premium' and exists(select 1 from public.user_subscriptions s where s.user_id=p.id and s.plan='premium' and (s.expires_at is null or s.expires_at>now())))
      or (p_premium='free' and not exists(select 1 from public.user_subscriptions s where s.user_id=p.id and s.plan='premium' and (s.expires_at is null or s.expires_at>now()))))
    and (coalesce(p_banned,'all')='all'
      or (p_banned='banned' and p.is_banned)
      or (p_banned='active' and not p.is_banned))
  order by p.created_at desc limit greatest(1,least(coalesce(p_limit,50),100))
  offset greatest(0,coalesce(p_offset,0));
end;
$$;
