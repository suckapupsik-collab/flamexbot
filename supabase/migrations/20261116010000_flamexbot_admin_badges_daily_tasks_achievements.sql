-- FLAMEXBOT 2.0: user badges, moderation, daily quest rotation and achievements.
-- This migration mirrors the SQL already applied to the connected Supabase project.

alter table public.profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists ban_reason text,
  add column if not exists banned_at timestamptz,
  add column if not exists banned_by uuid references public.profiles(id) on delete set null;

create table if not exists public.profile_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_code text not null check (badge_code in (
    'verified','founder','developer','administrator','moderator','designer',
    'creator','supporter','beta_tester','community_manager','partner'
  )),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(user_id,badge_code)
);
create index if not exists profile_badges_user_idx on public.profile_badges(user_id,created_at);
alter table public.profile_badges enable row level security;
drop policy if exists "Authenticated users view profile badges" on public.profile_badges;
create policy "Authenticated users view profile badges"
  on public.profile_badges for select to authenticated using (true);
revoke insert,update,delete on public.profile_badges from anon,authenticated;

create or replace function private.guard_profile_moderation_fields()
returns trigger language plpgsql set search_path=''
as $$
begin
  if auth.uid() is not null and auth.uid()=old.id and not public.is_flamexbot_admin()
    and (new.is_banned is distinct from old.is_banned
      or new.ban_reason is distinct from old.ban_reason
      or new.banned_at is distinct from old.banned_at
      or new.banned_by is distinct from old.banned_by)
  then raise exception 'Moderation fields can only be changed by FLAMEXBOT administrators'; end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_moderation_fields on public.profiles;
create trigger protect_profile_moderation_fields before update on public.profiles
for each row execute function private.guard_profile_moderation_fields();

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
  select p.id,p.username,p.display_name,p.telegram_username,p.telegram_id,p.avatar_url,p.created_at,
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

create or replace function public.admin_manage_flamexbot_user(
  p_user_id uuid,p_action text,p_badge_code text default null,p_reason text default null,p_days integer default 30
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_target public.profiles%rowtype;
  v_owner boolean;
  v_days integer:=coalesce(p_days,30);
begin
  if not public.is_flamexbot_admin() then raise exception 'Administrator access required'; end if;
  select * into v_target from public.profiles where id=p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  v_owner:=v_target.telegram_id='7781170049' or v_target.id='74a352c0-5a26-46a8-9b88-e71d0c3a9879'::uuid;
  case p_action
    when 'ban' then
      if v_owner then raise exception 'The FLAMEXBOT owner cannot be banned'; end if;
      update public.profiles set is_banned=true,ban_reason=nullif(trim(coalesce(p_reason,'')),''),banned_at=now(),banned_by=auth.uid(),updated_at=now() where id=p_user_id;
    when 'unban' then
      update public.profiles set is_banned=false,ban_reason=null,banned_at=null,banned_by=null,updated_at=now() where id=p_user_id;
    when 'verify' then
      insert into public.profile_badges(user_id,badge_code,granted_by) values(p_user_id,'verified',auth.uid()) on conflict(user_id,badge_code) do nothing;
    when 'unverify' then
      if v_owner then raise exception 'The owner verification badge is protected'; end if;
      delete from public.profile_badges where user_id=p_user_id and badge_code='verified';
    when 'premium_grant' then
      if v_days<0 or v_days>3650 then raise exception 'Premium duration must be between 0 and 3650 days'; end if;
      insert into public.user_subscriptions as current_subscription(user_id,plan,starts_at,expires_at,granted_by,updated_at)
      values(p_user_id,'premium',now(),case when v_days=0 then null else now()+make_interval(days=>v_days) end,auth.uid(),now())
      on conflict(user_id) do update set
        plan='premium',starts_at=now(),
        expires_at=case when v_days=0 then null else greatest(coalesce(current_subscription.expires_at,now()),now())+make_interval(days=>v_days) end,
        granted_by=auth.uid(),updated_at=now();
    when 'premium_revoke' then
      if v_owner then raise exception 'The owner Premium cannot be revoked'; end if;
      delete from public.user_subscriptions where user_id=p_user_id;
    when 'badge_grant' then
      if p_badge_code not in ('founder','developer','administrator','moderator','designer','creator','supporter','beta_tester','community_manager','partner','verified') then raise exception 'Unknown badge code'; end if;
      if p_badge_code='founder' and not v_owner then raise exception 'Founder badge is reserved for the project owner'; end if;
      insert into public.profile_badges(user_id,badge_code,granted_by) values(p_user_id,p_badge_code,auth.uid()) on conflict(user_id,badge_code) do nothing;
    when 'badge_revoke' then
      if v_owner and p_badge_code in ('founder','verified') then raise exception 'The owner badge is protected'; end if;
      delete from public.profile_badges where user_id=p_user_id and badge_code=p_badge_code and badge_code<>'founder';
    else raise exception 'Unsupported moderation action';
  end case;
  return jsonb_build_object('ok',true,'user_id',p_user_id,'action',p_action,'badge_code',p_badge_code);
end;
$$;
revoke all on function public.admin_list_flamexbot_users(text,text,text,text,integer,integer) from public,anon;
grant execute on function public.admin_list_flamexbot_users(text,text,text,text,integer,integer) to authenticated;
revoke all on function public.admin_manage_flamexbot_user(uuid,text,text,text,integer) from public,anon;
grant execute on function public.admin_manage_flamexbot_user(uuid,text,text,text,integer) to authenticated;

create or replace function private.get_flamexbot_daily_task_catalog()
returns table(task_order integer,task_code text,title text,description text,icon text,xp_reward integer)
language sql immutable set search_path=''
as $$
  select * from (values
    (1,'send_message','Зажечь диалог','Отправь хотя бы одно сообщение через Telegram Business','💬',10),
    (2,'receive_message','Быть на связи','Получи хотя бы одно входящее сообщение','📩',5),
    (3,'keep_streak','Сохранить огонёк','Поддержи хотя бы одну совместную серию сегодня','🔥',10),
    (4,'add_friend','Новое знакомство','Добавь нового друга в FLAMEXBOT сегодня','🤝',20),
    (5,'send_three_messages','Разговор пошёл','Отправь три сообщения через Business','🗨️',15),
    (6,'message_two_chats','На связи с двумя','Напиши в два разных Business-диалога','👥',20),
    (7,'receive_three_messages','Есть ответ!','Получи три входящих сообщения','📨',15),
    (8,'send_five_messages','Активный собеседник','Отправь пять сообщений за день','🚀',25),
    (9,'keep_two_streaks','Два огонька','Поддержи две совместные серии сегодня','🔥',20),
    (10,'message_three_chats','Общение без границ','Напиши в три разных Business-диалога','🌐',30)
  ) as t(task_order,task_code,title,description,icon,xp_reward);
$$;
create or replace function private.get_flamexbot_daily_task_codes()
returns text[] language sql stable set search_path=''
as $$
  with catalog as (
    select c.*,row_number() over(order by c.task_order)::integer as rn,count(*) over()::integer as total
    from private.get_flamexbot_daily_task_catalog() c
  ), seed as (
    select mod(abs(pg_catalog.hashtext((now() at time zone 'UTC')::date::text)::bigint),max(total)::bigint)::integer as start_index from catalog
  ), rotated as (
    select c.task_code,mod(c.rn-1-s.start_index+c.total,c.total) as slot from catalog c cross join seed s
  )
  select coalesce(array_agg(task_code order by slot),'{}'::text[]) from rotated where slot<3;
$$;
create or replace function public.get_flamexbot_daily_tasks()
returns table(task_code text,title text,description text,icon text,xp_reward integer)
language sql stable security definer set search_path=''
as $$
  select c.task_code,c.title,c.description,c.icon,c.xp_reward
  from private.get_flamexbot_daily_task_catalog() c
  where c.task_code=any(private.get_flamexbot_daily_task_codes())
  order by c.task_order;
$$;
revoke all on function public.get_flamexbot_daily_tasks() from public,anon;
grant execute on function public.get_flamexbot_daily_tasks() to authenticated;

create or replace function private.claim_flamexbot_daily_task(p_task_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_today date:=(now() at time zone 'UTC')::date;
  v_start timestamptz;
  v_end timestamptz;
  v_reward integer;
  v_done boolean:=false;
  v_claim_id uuid;
  v_count bigint:=0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not(p_task_code=any(private.get_flamexbot_daily_task_codes())) then raise exception 'This task is not active today'; end if;
  v_start:=v_today::timestamp at time zone 'UTC';v_end:=(v_today+1)::timestamp at time zone 'UTC';
  select c.xp_reward into v_reward from private.get_flamexbot_daily_task_catalog() c where c.task_code=p_task_code;
  case p_task_code
    when 'send_message' then
      select count(*) into v_count from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound' and m.created_at>=v_start and m.created_at<v_end;v_done:=v_count>=1;
    when 'receive_message' then
      select count(*) into v_count from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='inbound' and m.created_at>=v_start and m.created_at<v_end;v_done:=v_count>=1;
    when 'keep_streak' then
      select count(*) into v_count from public.streaks s where (s.user_low=v_uid or s.user_high=v_uid) and s.last_activity_date=v_today;v_done:=v_count>=1;
    when 'add_friend' then
      select count(*) into v_count from public.friendships f where (f.user_low=v_uid or f.user_high=v_uid) and f.created_at>=v_start and f.created_at<v_end;v_done:=v_count>=1;
    when 'send_three_messages' then
      select count(*) into v_count from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound' and m.created_at>=v_start and m.created_at<v_end;v_done:=v_count>=3;
    when 'message_two_chats' then
      select count(distinct m.business_chat_id) into v_count from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound' and m.created_at>=v_start and m.created_at<v_end;v_done:=v_count>=2;
    when 'receive_three_messages' then
      select count(*) into v_count from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='inbound' and m.created_at>=v_start and m.created_at<v_end;v_done:=v_count>=3;
    when 'send_five_messages' then
      select count(*) into v_count from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound' and m.created_at>=v_start and m.created_at<v_end;v_done:=v_count>=5;
    when 'keep_two_streaks' then
      select count(*) into v_count from public.streaks s where (s.user_low=v_uid or s.user_high=v_uid) and s.last_activity_date=v_today;v_done:=v_count>=2;
    when 'message_three_chats' then
      select count(distinct m.business_chat_id) into v_count from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound' and m.created_at>=v_start and m.created_at<v_end;v_done:=v_count>=3;
    else raise exception 'Unknown daily task';
  end case;
  if not v_done then raise exception 'Task is not completed yet'; end if;
  insert into public.flamexbot_daily_task_claims(user_id,task_code,task_date,xp_reward)
  values(v_uid,p_task_code,v_today,v_reward) on conflict(user_id,task_date,task_code) do nothing returning id into v_claim_id;
  if v_claim_id is null then raise exception 'Task reward already claimed today'; end if;
  return jsonb_build_object('task_code',p_task_code,'xp_reward',v_reward,'task_date',v_today,'claimed',true);
end;
$$;

create or replace function private.sync_flamexbot_achievements()
returns integer language plpgsql security definer set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_added integer:=0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  insert into public.user_achievements(user_id,achievement_id)
  select v_uid,a.id from public.achievements a where
    (a.code='first_message' and exists(select 1 from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound'))
    or (a.code='first_friend' and exists(select 1 from public.friendships f where f.user_low=v_uid or f.user_high=v_uid))
    or (a.code='first_flame' and exists(select 1 from public.streaks s where (s.user_low=v_uid or s.user_high=v_uid) and greatest(s.current_days,s.best_days)>=1))
    or (a.code='streak_7' and exists(select 1 from public.streaks s where (s.user_low=v_uid or s.user_high=v_uid) and greatest(s.current_days,s.best_days)>=7))
    or (a.code='streak_30' and exists(select 1 from public.streaks s where (s.user_low=v_uid or s.user_high=v_uid) and greatest(s.current_days,s.best_days)>=30))
    or (a.code='streak_100' and exists(select 1 from public.streaks s where (s.user_low=v_uid or s.user_high=v_uid) and greatest(s.current_days,s.best_days)>=100))
    or (a.code='message_25' and (select count(*) from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound')>=25)
    or (a.code='message_100' and (select count(*) from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound')>=100)
    or (a.code='message_500' and (select count(*) from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound')>=500)
    or (a.code='social_3' and (select count(*) from public.friendships f where f.user_low=v_uid or f.user_high=v_uid)>=3)
    or (a.code='social_10' and (select count(*) from public.friendships f where f.user_low=v_uid or f.user_high=v_uid)>=10)
    or (a.code='business_3' and (select count(*) from public.flamexbot_business_chats c where c.profile_id=v_uid)>=3)
    or (a.code='daily_quests_5' and (select count(*) from public.flamexbot_daily_task_claims t where t.user_id=v_uid)>=5)
    or (a.code='daily_quests_25' and (select count(*) from public.flamexbot_daily_task_claims t where t.user_id=v_uid)>=25)
    or (a.code='profile_complete' and exists(select 1 from public.profiles p where p.id=v_uid and length(trim(p.bio))>=20 and coalesce(p.avatar_url,p.telegram_photo_url) is not null))
    or (a.code='premium_member' and exists(select 1 from public.user_subscriptions s where s.user_id=v_uid and s.plan='premium' and (s.expires_at is null or s.expires_at>now())))
    or (a.code='account_30_days' and exists(select 1 from public.profiles p where p.id=v_uid and p.created_at<=now()-interval '30 days'))
    or (a.code='early_bird' and exists(select 1 from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound' and extract(hour from m.created_at at time zone 'UTC') between 5 and 7))
    or (a.code='night_owl' and exists(select 1 from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=v_uid and m.direction='outbound' and extract(hour from m.created_at at time zone 'UTC')>=22)
  on conflict(user_id,achievement_id) do nothing;
  get diagnostics v_added=row_count;
  return v_added;
end;
$$;

insert into public.achievements(code,title,description,icon,points) values
 ('first_message','Первый огонёк','Отправь своё первое сообщение через FLAMEXBOT','💬',10),
 ('first_friend','Первый друг','Добавь первого друга в сообщество','🤝',15),
 ('first_flame','Искра','Зажги первую совместную серию','🔥',15),
 ('streak_7','Неделя на связи','Поддерживай огонёк семь дней подряд','🌟',40),
 ('streak_30','Месяц общения','Держи совместную серию 30 дней','🏅',100),
 ('streak_100','Легенда огонька','Достигни серии в 100 дней','👑',300),
 ('message_25','Разговорчивый','Отправь 25 сообщений','🗨️',25),
 ('message_100','Голос сообщества','Отправь 100 сообщений','📣',75),
 ('message_500','Неутомимый','Отправь 500 сообщений','🚀',200),
 ('social_3','Своя компания','Подружись с тремя участниками','👥',40),
 ('social_10','Душа компании','Собери десять друзей','🎉',120),
 ('business_3','Многозадачный','Общайся в трёх Business-диалогах','📡',40),
 ('daily_quests_5','Охотник за XP','Забери пять ежедневных наград','⚡',40),
 ('daily_quests_25','Мастер заданий','Забери 25 ежедневных наград','💎',120),
 ('profile_complete','Открытая книга','Заполни профиль и добавь аватар','📖',20),
 ('premium_member','Премиум-участник','Открой возможности Premium','✦',30),
 ('account_30_days','Старожил','Проведи в FLAMEXBOT 30 дней','🗓️',50),
 ('early_bird','Ранняя пташка','Отправь сообщение до 08:00 UTC','🌅',20),
 ('night_owl','Ночная смена','Отправь сообщение после 22:00 UTC','🌙',20)
on conflict(code) do update set title=excluded.title,description=excluded.description,icon=excluded.icon,points=excluded.points;

insert into public.profile_badges(user_id,badge_code,granted_by) values
 ('74a352c0-5a26-46a8-9b88-e71d0c3a9879','founder',null),
 ('74a352c0-5a26-46a8-9b88-e71d0c3a9879','verified',null),
 ('74a352c0-5a26-46a8-9b88-e71d0c3a9879','developer',null),
 ('74a352c0-5a26-46a8-9b88-e71d0c3a9879','administrator',null)
on conflict(user_id,badge_code) do nothing;
