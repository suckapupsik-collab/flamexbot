create or replace function public.is_flamexbot_user_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists(
      select 1 from public.profiles p
      where p.id=auth.uid() and p.is_banned=false
    );
$$;
revoke all on function public.is_flamexbot_user_active() from public,anon;
grant execute on function public.is_flamexbot_user_active() to authenticated;

do $$
declare
  p record;
  statement text;
begin
  for p in
    select schemaname,tablename,policyname,qual,with_check,cmd
    from pg_policies
    where schemaname='public'
      and roles @> array['authenticated']::name[]
      and not (tablename='profiles' and cmd='SELECT')
      and not (tablename='achievements' and cmd='SELECT')
      and not (tablename='profile_badges' and cmd='SELECT')
  loop
    statement := format('ALTER POLICY %I ON %I.%I',p.policyname,p.schemaname,p.tablename);
    if p.qual is not null and position('is_flamexbot_user_active' in coalesce(p.qual,''))=0 then
      statement := statement || format(' USING ((%s) AND public.is_flamexbot_user_active())',p.qual);
    elsif p.qual is not null then
      statement := statement || format(' USING (%s)',p.qual);
    end if;
    if p.with_check is not null and position('is_flamexbot_user_active' in coalesce(p.with_check,''))=0 then
      statement := statement || format(' WITH CHECK ((%s) AND public.is_flamexbot_user_active())',p.with_check);
    elsif p.with_check is not null then
      statement := statement || format(' WITH CHECK (%s)',p.with_check);
    end if;
    execute statement;
  end loop;
end;
$$;

create table if not exists public.flamexbot_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  badge_code text,
  reason text,
  duration_days integer,
  created_at timestamptz not null default now()
);
create index if not exists flamexbot_admin_audit_created_idx
  on public.flamexbot_admin_audit(created_at desc);
alter table public.flamexbot_admin_audit enable row level security;
drop policy if exists "Only FLAMEXBOT owner views admin audit" on public.flamexbot_admin_audit;
create policy "Only FLAMEXBOT owner views admin audit"
  on public.flamexbot_admin_audit for select to authenticated
  using (public.is_flamexbot_admin() and public.is_flamexbot_user_active());
revoke all on public.flamexbot_admin_audit from anon,authenticated;
grant select on public.flamexbot_admin_audit to authenticated;

create or replace function public.admin_list_flamexbot_audit(p_limit integer default 20)
returns table(
  id uuid,
  action text,
  badge_code text,
  reason text,
  duration_days integer,
  created_at timestamptz,
  actor_name text,
  target_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_flamexbot_admin() then raise exception 'Administrator access required'; end if;
  return query
  select a.id,a.action,a.badge_code,a.reason,a.duration_days,a.created_at,
    coalesce(actor.display_name,actor.username,'Администратор'),
    coalesce(target.display_name,target.username,'Пользователь')
  from public.flamexbot_admin_audit a
  join public.profiles actor on actor.id=a.actor_id
  join public.profiles target on target.id=a.target_user_id
  order by a.created_at desc
  limit greatest(1,least(coalesce(p_limit,20),100));
end;
$$;
revoke all on function public.admin_list_flamexbot_audit(integer) from public,anon;
grant execute on function public.admin_list_flamexbot_audit(integer) to authenticated;

create or replace function public.admin_manage_flamexbot_user(
  p_user_id uuid,
  p_action text,
  p_badge_code text default null,
  p_reason text default null,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles%rowtype;
  v_owner boolean;
  v_days integer := coalesce(p_days,30);
begin
  if not public.is_flamexbot_admin() then raise exception 'Administrator access required'; end if;
  select * into v_target from public.profiles where id=p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  v_owner := v_target.telegram_id='7781170049' or v_target.id='74a352c0-5a26-46a8-9b88-e71d0c3a9879'::uuid;

  case p_action
    when 'ban' then
      if v_owner then raise exception 'The FLAMEXBOT owner cannot be banned'; end if;
      update public.profiles
        set is_banned=true,ban_reason=nullif(trim(coalesce(p_reason,'')),''),banned_at=now(),banned_by=auth.uid(),updated_at=now()
        where id=p_user_id;
      update auth.users set banned_until=now()+interval '100 years' where id=p_user_id;
    when 'unban' then
      update public.profiles
        set is_banned=false,ban_reason=null,banned_at=null,banned_by=null,updated_at=now()
        where id=p_user_id;
      update auth.users set banned_until=null where id=p_user_id;
    when 'verify' then
      insert into public.profile_badges(user_id,badge_code,granted_by)
      values(p_user_id,'verified',auth.uid()) on conflict(user_id,badge_code) do nothing;
    when 'unverify' then
      if v_owner then raise exception 'The owner verification badge is protected'; end if;
      delete from public.profile_badges where user_id=p_user_id and badge_code='verified';
    when 'premium_grant' then
      if v_days<0 or v_days>3650 then raise exception 'Premium duration must be between 0 and 3650 days'; end if;
      insert into public.user_subscriptions as current_subscription(user_id,plan,starts_at,expires_at,granted_by,updated_at)
      values(p_user_id,'premium',now(),case when v_days=0 then null else now()+make_interval(days=>v_days) end,auth.uid(),now())
      on conflict(user_id) do update set
        plan='premium',
        starts_at=now(),
        expires_at=case when v_days=0 then null else greatest(coalesce(current_subscription.expires_at,now()),now())+make_interval(days=>v_days) end,
        granted_by=auth.uid(),
        updated_at=now();
    when 'premium_revoke' then
      if v_owner then raise exception 'The owner Premium cannot be revoked'; end if;
      delete from public.user_subscriptions where user_id=p_user_id;
    when 'badge_grant' then
      if p_badge_code not in ('founder','developer','administrator','moderator','designer','creator','supporter','beta_tester','community_manager','partner','verified') then
        raise exception 'Unknown badge code';
      end if;
      if p_badge_code='founder' and not v_owner then raise exception 'Founder badge is reserved for the project owner'; end if;
      insert into public.profile_badges(user_id,badge_code,granted_by)
      values(p_user_id,p_badge_code,auth.uid()) on conflict(user_id,badge_code) do nothing;
    when 'badge_revoke' then
      if v_owner and p_badge_code in ('founder','verified') then raise exception 'The owner badge is protected'; end if;
      delete from public.profile_badges where user_id=p_user_id and badge_code=p_badge_code and badge_code<>'founder';
    else
      raise exception 'Unsupported moderation action';
  end case;

  insert into public.flamexbot_admin_audit(actor_id,target_user_id,action,badge_code,reason,duration_days)
  values(auth.uid(),p_user_id,p_action,p_badge_code,nullif(trim(coalesce(p_reason,'')),''),case when p_action='premium_grant' then v_days else null end);

  return jsonb_build_object('ok',true,'user_id',p_user_id,'action',p_action,'badge_code',p_badge_code);
end;
$$;
revoke all on function public.admin_manage_flamexbot_user(uuid,text,text,text,integer) from public,anon;
grant execute on function public.admin_manage_flamexbot_user(uuid,text,text,text,integer) to authenticated;

create or replace function public.get_flamexbot_daily_task_progress()
returns table(task_code text,current_progress integer,target_progress integer,completed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'UTC')::date;
  v_start timestamptz;
  v_end timestamptz;
  v_sent integer := 0;
  v_received integer := 0;
  v_chats integer := 0;
  v_streaks integer := 0;
  v_friends integer := 0;
begin
  if not public.is_flamexbot_user_active() then raise exception 'Account is not active'; end if;
  v_start := v_today::timestamp at time zone 'UTC';
  v_end := (v_today+1)::timestamp at time zone 'UTC';
  select count(*)::integer into v_sent from public.flamexbot_business_messages m
    join public.flamexbot_business_chats c on c.id=m.business_chat_id
    where c.profile_id=v_uid and m.direction='outbound' and m.created_at>=v_start and m.created_at<v_end;
  select count(*)::integer into v_received from public.flamexbot_business_messages m
    join public.flamexbot_business_chats c on c.id=m.business_chat_id
    where c.profile_id=v_uid and m.direction='inbound' and m.created_at>=v_start and m.created_at<v_end;
  select count(distinct m.business_chat_id)::integer into v_chats from public.flamexbot_business_messages m
    join public.flamexbot_business_chats c on c.id=m.business_chat_id
    where c.profile_id=v_uid and m.direction='outbound' and m.created_at>=v_start and m.created_at<v_end;
  select count(*)::integer into v_streaks from public.streaks s
    where (s.user_low=v_uid or s.user_high=v_uid) and s.last_activity_date=v_today;
  select count(*)::integer into v_friends from public.friendships f
    where (f.user_low=v_uid or f.user_high=v_uid) and f.created_at>=v_start and f.created_at<v_end;
  return query
  select c.task_code,
    case c.task_code
      when 'send_message' then v_sent when 'receive_message' then v_received
      when 'keep_streak' then v_streaks when 'add_friend' then v_friends
      when 'send_three_messages' then v_sent when 'message_two_chats' then v_chats
      when 'receive_three_messages' then v_received when 'send_five_messages' then v_sent
      when 'keep_two_streaks' then v_streaks when 'message_three_chats' then v_chats else 0 end,
    case c.task_code
      when 'send_message' then 1 when 'receive_message' then 1 when 'keep_streak' then 1
      when 'add_friend' then 1 when 'send_three_messages' then 3 when 'message_two_chats' then 2
      when 'receive_three_messages' then 3 when 'send_five_messages' then 5
      when 'keep_two_streaks' then 2 when 'message_three_chats' then 3 else 1 end,
    case c.task_code
      when 'send_message' then v_sent>=1 when 'receive_message' then v_received>=1
      when 'keep_streak' then v_streaks>=1 when 'add_friend' then v_friends>=1
      when 'send_three_messages' then v_sent>=3 when 'message_two_chats' then v_chats>=2
      when 'receive_three_messages' then v_received>=3 when 'send_five_messages' then v_sent>=5
      when 'keep_two_streaks' then v_streaks>=2 when 'message_three_chats' then v_chats>=3 else false end
  from private.get_flamexbot_daily_task_catalog() c
  where c.task_code=any(private.get_flamexbot_daily_task_codes())
  order by c.task_order;
end;
$$;
revoke all on function public.get_flamexbot_daily_task_progress() from public,anon;
grant execute on function public.get_flamexbot_daily_task_progress() to authenticated;

create or replace function public.claim_flamexbot_daily_task(p_task_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_flamexbot_user_active() then raise exception 'Account is not active'; end if;
  return private.claim_flamexbot_daily_task(p_task_code);
end;
$$;
revoke all on function public.claim_flamexbot_daily_task(text) from public,anon;
grant execute on function public.claim_flamexbot_daily_task(text) to authenticated;

create or replace function public.sync_flamexbot_achievements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_flamexbot_user_active() then raise exception 'Account is not active'; end if;
  return private.sync_flamexbot_achievements();
end;
$$;
revoke all on function public.sync_flamexbot_achievements() from public,anon;
grant execute on function public.sync_flamexbot_achievements() to authenticated;

revoke all on function private.claim_flamexbot_daily_task(text) from public,anon,authenticated;
revoke all on function private.sync_flamexbot_achievements() from public,anon,authenticated;
