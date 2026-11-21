
-- FLAMEXBOT membership tiers, protected Founder plan, weekly wheel grants and prize engine.

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_plan_check;
alter table public.user_subscriptions
  add constraint user_subscriptions_plan_check
  check (plan = any (array['free','premium','pro','founder']::text[]));

create or replace function public.keep_flamexbot_founder_subscription()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_founder_id uuid;
begin
  select p.id into v_founder_id from public.profiles p
  where p.telegram_id='7781170049' limit 1;
  if v_founder_id is not null and new.user_id=v_founder_id then
    new.plan:='founder';
    new.expires_at:=null;
    new.updated_at:=now();
  end if;
  return new;
end;
$function$;

drop trigger if exists keep_flamexbot_founder_subscription on public.user_subscriptions;
create trigger keep_flamexbot_founder_subscription
before insert or update on public.user_subscriptions
for each row execute function public.keep_flamexbot_founder_subscription();

insert into public.profile_badges(user_id,badge_code,granted_by)
select p.id,'founder',p.id from public.profiles p where p.telegram_id='7781170049'
on conflict(user_id,badge_code) do nothing;

insert into public.user_subscriptions(user_id,plan,starts_at,expires_at,granted_by,updated_at)
select p.id,'founder',now(),null,p.id,now() from public.profiles p where p.telegram_id='7781170049'
on conflict(user_id) do update set plan='founder',expires_at=null,updated_at=now();

create table if not exists public.flamexbot_weekly_wheel_grants (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  plan text not null check (plan in ('premium','pro','founder')),
  granted_spins integer not null check (granted_spins between 1 and 3),
  created_at timestamptz not null default now(),
  primary key(user_id,week_start)
);
alter table public.flamexbot_weekly_wheel_grants enable row level security;
revoke all on table public.flamexbot_weekly_wheel_grants from public,anon,authenticated;
grant select,insert,update,delete on table public.flamexbot_weekly_wheel_grants to service_role;
create index if not exists flamexbot_weekly_wheel_grants_week_idx
  on public.flamexbot_weekly_wheel_grants(week_start desc);

create or replace function public.grant_flamexbot_weekly_wheel_spins()
returns integer language plpgsql security definer set search_path = ''
as $function$
declare
  v_week_start date:=date_trunc('week',now() at time zone 'UTC')::date;
  v_grant record;
  v_total integer:=0;
begin
  for v_grant in
    insert into public.flamexbot_weekly_wheel_grants(user_id,week_start,plan,granted_spins)
    select s.user_id,v_week_start,s.plan,
      case s.plan when 'founder' then 3 when 'pro' then 2 else 1 end
    from public.user_subscriptions s
    join public.profiles p on p.id=s.user_id
    where s.plan in ('premium','pro','founder')
      and (s.expires_at is null or s.expires_at>now())
      and p.is_banned=false
    on conflict(user_id,week_start) do nothing
    returning user_id,plan,granted_spins
  loop
    update public.profiles
    set wheel_free_spins=wheel_free_spins+v_grant.granted_spins,updated_at=now()
    where id=v_grant.user_id;
    insert into public.notifications(user_id,type,title,body,data)
    values(
      v_grant.user_id,'weekly_wheel_spins','Еженедельные прокрутки начислены',
      case v_grant.plan
        when 'founder' then 'Тариф FOUNDER: начислено 3 бесплатные прокрутки колеса.'
        when 'pro' then 'Тариф PRO: начислено 2 бесплатные прокрутки колеса.'
        else 'Тариф Premium: начислена 1 бесплатная прокрутка колеса.'
      end,
      jsonb_build_object('week_start',v_week_start,'plan',v_grant.plan,'spins',v_grant.granted_spins)
    );
    v_total:=v_total+v_grant.granted_spins;
  end loop;
  return v_total;
end;
$function$;
revoke all on function public.grant_flamexbot_weekly_wheel_spins() from public,anon,authenticated;
grant execute on function public.grant_flamexbot_weekly_wheel_spins() to service_role;

create or replace function public.draw_flamexbot_wheel_prize(p_user_id uuid,p_random_value numeric default null)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_now timestamptz:=now();
  v_plan text;
  v_expires_at timestamptz;
  v_boost numeric:=1;
  v_total numeric;
  v_roll numeric;
  v_type text;
  v_code text;
  v_label text;
  v_reward_plan text;
  v_days integer;
  v_current_plan text;
  v_current_expires timestamptz;
  v_has_subscription boolean:=false;
  v_current_rank integer:=0;
  v_reward_rank integer:=0;
begin
  if p_random_value is not null and (p_random_value<0 or p_random_value>=1) then
    raise exception 'Random value must be between 0 and 1';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_user_id and p.is_banned=false) then
    raise exception 'Wheel account is unavailable';
  end if;

  select s.plan,s.expires_at into v_plan,v_expires_at
  from public.user_subscriptions s where s.user_id=p_user_id;

  if v_plan='founder' and (v_expires_at is null or v_expires_at>v_now) then
    v_boost:=1.15;
  elsif v_plan='pro' and (v_expires_at is null or v_expires_at>v_now) then
    v_boost:=1.10;
  end if;

  -- Baseline weights: spin 55, protection 25, Premium 7d 12;
  -- rare rewards: Premium 30d 5, Premium 90d 1.5, PRO 7d 1,
  -- PRO 30d 0.4, PRO 90d 0.1. PRO raises rare weights by 10%;
  -- Founder raises rare weights by 15%.
  v_total:=92+(8*v_boost);
  v_roll:=coalesce(p_random_value,random())*v_total;

  if v_roll<55 then
    v_type:='free_spin';v_code:='wheel_spin_1';v_label:='Бесплатная прокрутка';
  elsif v_roll<80 then
    v_type:='addon';v_code:='command_protection_5d';v_label:='Защита от команд на 5 дней';
  elsif v_roll<92 then
    v_type:='premium_7d';v_code:='premium_7d';v_label:='Premium на 7 дней';
  elsif v_roll<92+(5*v_boost) then
    v_type:='premium_30d';v_code:='premium_30d';v_label:='Premium на 30 дней';
  elsif v_roll<92+(6.5*v_boost) then
    v_type:='premium_90d';v_code:='premium_90d';v_label:='Premium на 90 дней';
  elsif v_roll<92+(7.5*v_boost) then
    v_type:='pro_7d';v_code:='pro_7d';v_label:='PRO на 7 дней';
  elsif v_roll<92+(7.9*v_boost) then
    v_type:='pro_30d';v_code:='pro_30d';v_label:='PRO на 30 дней';
  else
    v_type:='pro_90d';v_code:='pro_90d';v_label:='PRO на 90 дней';
  end if;

  if v_type='free_spin' then
    update public.profiles set wheel_free_spins=wheel_free_spins+1,updated_at=v_now where id=p_user_id;
  elsif v_type='addon' then
    update public.profiles set
      command_protection_expires_at=greatest(coalesce(command_protection_expires_at,v_now),v_now)+interval '5 days',
      updated_at=v_now
    where id=p_user_id;
    insert into public.flamexbot_addon_entitlements(user_id,addon_code,expires_at,source)
    values(p_user_id,'command_protection',v_now+interval '5 days','wheel');
  else
    v_days:=case v_type
      when 'premium_7d' then 7 when 'premium_30d' then 30 when 'premium_90d' then 90
      when 'pro_7d' then 7 when 'pro_30d' then 30 when 'pro_90d' then 90 else 7 end;
    v_reward_plan:=case when v_type like 'pro_%' then 'pro' else 'premium' end;
    v_reward_rank:=case v_reward_plan when 'pro' then 2 else 1 end;

    select s.plan,s.expires_at into v_current_plan,v_current_expires
    from public.user_subscriptions s where s.user_id=p_user_id for update;
    v_has_subscription:=found;

    -- Convert subscription prizes to one free spin for lifetime accounts.
    if v_has_subscription and v_current_expires is null then
      update public.profiles set wheel_free_spins=wheel_free_spins+1,updated_at=v_now where id=p_user_id;
      v_type:='free_spin';v_code:='wheel_spin_1';
      v_label:='Бесплатная прокрутка (бессрочный тариф уже активен)';
    else
      if v_has_subscription and v_current_expires>v_now then
        v_current_rank:=case v_current_plan when 'founder' then 3 when 'pro' then 2 when 'premium' then 1 else 0 end;
      end if;
      if v_current_rank>v_reward_rank then v_reward_plan:=v_current_plan; end if;
      insert into public.user_subscriptions(user_id,plan,starts_at,expires_at,granted_by,updated_at)
      values(p_user_id,v_reward_plan,v_now,v_now+make_interval(days=>v_days),null,v_now)
      on conflict(user_id) do update
      set plan=v_reward_plan,
          starts_at=case when public.user_subscriptions.expires_at>v_now
            then public.user_subscriptions.starts_at else v_now end,
          expires_at=greatest(coalesce(public.user_subscriptions.expires_at,v_now),v_now)+make_interval(days=>v_days),
          granted_by=null,updated_at=v_now;
    end if;
  end if;

  return jsonb_build_object('applied',true,'prize_type',v_type,'prize_code',v_code,'prize_label',v_label);
end;
$function$;
revoke all on function public.draw_flamexbot_wheel_prize(uuid,numeric) from public,anon,authenticated;
grant execute on function public.draw_flamexbot_wheel_prize(uuid,numeric) to service_role;

create or replace function public.apply_flamexbot_wheel_payment(
  p_invoice_payload text,p_telegram_user_id text,p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text,p_currency text,p_total_amount integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_order public.flamexbot_wheel_orders%rowtype;
  v_prize jsonb;
begin
  select * into v_order from public.flamexbot_wheel_orders
  where invoice_payload=p_invoice_payload for update;
  if not found then raise exception 'Wheel order not found'; end if;
  if v_order.telegram_user_id<>p_telegram_user_id or p_currency<>'XTR'
     or p_total_amount<>v_order.price_stars or v_order.price_stars<>5
     or nullif(trim(coalesce(p_telegram_payment_charge_id,'')),'') is null then
    raise exception 'Wheel payment does not match the order';
  end if;
  if v_order.status='paid' then
    return jsonb_build_object('applied',false,'prize_type',v_order.prize_type,
      'prize_code',v_order.prize_code,'prize_label',v_order.prize_label);
  end if;
  if v_order.status<>'pending' then raise exception 'Wheel order is not payable'; end if;

  v_prize:=public.draw_flamexbot_wheel_prize(v_order.user_id,null);
  update public.flamexbot_wheel_orders set status='paid',
    prize_type=v_prize->>'prize_type',prize_code=v_prize->>'prize_code',
    prize_label=v_prize->>'prize_label',telegram_payment_charge_id=p_telegram_payment_charge_id,
    provider_payment_charge_id=p_provider_payment_charge_id,paid_at=now()
  where id=v_order.id;
  insert into public.notifications(user_id,type,title,body,data)
  values(v_order.user_id,'wheel_prize','Награда колеса фортуны',
    'Выпала награда: '||coalesce(v_prize->>'prize_label','Награда начислена')||'.',
    jsonb_build_object('prize_type',v_prize->>'prize_type','prize_code',v_prize->>'prize_code',
      'wheel_order_id',v_order.id));
  return v_prize||jsonb_build_object('applied',true);
end;
$function$;

create or replace function public.redeem_flamexbot_free_wheel_spin(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_prize jsonb;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id then
    raise exception 'Cannot redeem another user''s wheel spin';
  end if;
  update public.profiles set wheel_free_spins=wheel_free_spins-1,updated_at=now()
  where id=p_user_id and wheel_free_spins>0 and is_banned=false;
  if not found then raise exception 'No free spins available'; end if;
  v_prize:=public.draw_flamexbot_wheel_prize(p_user_id,null);
  insert into public.notifications(user_id,type,title,body,data)
  values(p_user_id,'wheel_prize','Награда колеса фортуны',
    'Выпала награда: '||coalesce(v_prize->>'prize_label','Награда начислена')||'.',
    jsonb_build_object('prize_type',v_prize->>'prize_type','prize_code',v_prize->>'prize_code'));
  return v_prize||jsonb_build_object('applied',true);
end;
$function$;
revoke all on function public.apply_flamexbot_wheel_payment(text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.apply_flamexbot_wheel_payment(text,text,text,text,text,integer) to service_role;
revoke all on function public.redeem_flamexbot_free_wheel_spin(uuid) from public,anon;
grant execute on function public.redeem_flamexbot_free_wheel_spin(uuid) to authenticated,service_role;

create or replace function public.admin_get_flamexbot_user(p_user_id uuid)
returns table(
  id uuid,username text,display_name text,telegram_id text,telegram_username text,
  avatar_url text,telegram_photo_url text,created_at timestamptz,is_banned boolean,
  ban_reason text,is_verified boolean,is_premium boolean,premium_expires_at timestamptz,
  badge_codes text[],total_messages bigint,friends_count bigint,best_streak integer,
  achievements_count bigint,xp bigint
)
language plpgsql security definer set search_path = ''
as $function$
begin
  if not public.is_flamexbot_admin() then raise exception 'Administrator access required'; end if;
  return query
  select p.id,p.username,p.display_name,p.telegram_id,p.telegram_username,p.avatar_url,p.telegram_photo_url,
    p.created_at,p.is_banned,p.ban_reason,
    (p.telegram_id='7781170049' or coalesce(bool_or(b.badge_code='verified'),false)),
    coalesce(s.plan in ('premium','pro','founder') and (s.expires_at is null or s.expires_at>now()),false),
    s.expires_at,
    (coalesce(array_agg(b.badge_code) filter(where b.badge_code is not null),'{}'::text[])
      || case when s.plan='pro' and (s.expires_at is null or s.expires_at>now()) then array['pro']::text[] else '{}'::text[] end
      || case when s.plan='founder' and (s.expires_at is null or s.expires_at>now()) then array['founder']::text[] else '{}'::text[] end),
    (select count(*) from public.flamexbot_business_messages m join public.flamexbot_business_chats c on c.id=m.business_chat_id where c.profile_id=p.id),
    (select count(*) from public.friendships f where f.user_low=p.id or f.user_high=p.id),
    coalesce((select max(st.best_days) from public.streaks st where st.user_low=p.id or st.user_high=p.id),0),
    (select count(*) from public.user_achievements ua where ua.user_id=p.id),
    (coalesce((select sum(a.points) from public.user_achievements ua join public.achievements a on a.id=ua.achievement_id where ua.user_id=p.id),0)
      +coalesce((select sum(cl.xp_reward) from public.flamexbot_daily_task_claims cl where cl.user_id=p.id),0))::bigint
  from public.profiles p left join public.profile_badges b on b.user_id=p.id
  left join public.user_subscriptions s on s.user_id=p.id
  where p.id=p_user_id group by p.id,s.plan,s.expires_at;
end;
$function$;

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
language plpgsql security definer set search_path = ''
as $function$
begin
  if not public.is_flamexbot_admin() then raise exception 'Administrator access required'; end if;
  return query
  select p.id,p.username,p.display_name,p.telegram_username,p.telegram_id,
    coalesce(p.avatar_url,p.telegram_photo_url),p.created_at,p.is_banned,p.ban_reason,
    (p.telegram_id='7781170049' or exists(select 1 from public.profile_badges b where b.user_id=p.id and b.badge_code='verified')),
    exists(select 1 from public.user_subscriptions s where s.user_id=p.id and s.plan in ('premium','pro','founder') and (s.expires_at is null or s.expires_at>now())),
    (select s.expires_at from public.user_subscriptions s where s.user_id=p.id and s.plan in ('premium','pro','founder') and (s.expires_at is null or s.expires_at>now()) limit 1),
    (coalesce((select array_agg(b.badge_code order by b.created_at) from public.profile_badges b where b.user_id=p.id),'{}'::text[])
      || case when exists(select 1 from public.user_subscriptions s where s.user_id=p.id and s.plan='pro' and (s.expires_at is null or s.expires_at>now())) then array['pro']::text[] else '{}'::text[] end
      || case when exists(select 1 from public.user_subscriptions s where s.user_id=p.id and s.plan='founder' and (s.expires_at is null or s.expires_at>now())) then array['founder']::text[] else '{}'::text[] end),
    count(*) over()
  from public.profiles p
  where (
    nullif(trim(coalesce(p_search,'')),'') is null or p.username ilike '%'||trim(p_search)||'%'
    or p.display_name ilike '%'||trim(p_search)||'%' or coalesce(p.telegram_username,'') ilike '%'||trim(p_search)||'%'
    or coalesce(p.telegram_id,'') ilike '%'||trim(p_search)||'%'
  )
  and (
    coalesce(p_verified,'all')='all'
    or (p_verified='verified' and (p.telegram_id='7781170049' or exists(select 1 from public.profile_badges b where b.user_id=p.id and b.badge_code='verified')))
    or (p_verified='unverified' and coalesce(p.telegram_id,'')<>'7781170049' and not exists(select 1 from public.profile_badges b where b.user_id=p.id and b.badge_code='verified'))
  )
  and (
    coalesce(p_premium,'all')='all'
    or (p_premium='premium' and exists(select 1 from public.user_subscriptions s where s.user_id=p.id and s.plan in ('premium','pro','founder') and (s.expires_at is null or s.expires_at>now())))
    or (p_premium='free' and not exists(select 1 from public.user_subscriptions s where s.user_id=p.id and s.plan in ('premium','pro','founder') and (s.expires_at is null or s.expires_at>now())))
  )
  and (
    coalesce(p_banned,'all')='all' or (p_banned='banned' and p.is_banned) or (p_banned='active' and not p.is_banned)
  )
  order by p.created_at desc limit greatest(1,least(coalesce(p_limit,50),100)) offset greatest(0,coalesce(p_offset,0));
end;
$function$;

create or replace function public.apply_flamexbot_star_payment(
  p_user_id uuid,p_telegram_user_id text,p_invoice_payload text,p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text,p_currency text,p_total_amount integer,p_period_days integer
)
returns boolean language plpgsql security definer set search_path = 'public','pg_temp'
as $function$
declare v_payment_id uuid;v_now timestamptz:=now();
begin
  if p_currency<>'XTR' or p_total_amount<=0 or p_period_days<=0
     or nullif(trim(coalesce(p_telegram_payment_charge_id,'')),'') is null then
    raise exception 'Invalid Telegram Stars payment';
  end if;
  insert into public.flamexbot_star_payments(user_id,telegram_user_id,invoice_payload,telegram_payment_charge_id,
    provider_payment_charge_id,currency,total_amount,period_days)
  values(p_user_id,p_telegram_user_id,p_invoice_payload,p_telegram_payment_charge_id,
    p_provider_payment_charge_id,p_currency,p_total_amount,p_period_days)
  on conflict(telegram_payment_charge_id) do nothing returning id into v_payment_id;
  if v_payment_id is null then return false; end if;
  insert into public.user_subscriptions(user_id,plan,starts_at,expires_at,granted_by,updated_at)
  values(p_user_id,'premium',v_now,v_now+make_interval(days=>p_period_days),null,v_now)
  on conflict(user_id) do update
  set plan=case
      when public.user_subscriptions.plan in ('pro','founder')
        and (public.user_subscriptions.expires_at is null or public.user_subscriptions.expires_at>v_now)
      then public.user_subscriptions.plan else 'premium' end,
    starts_at=case when public.user_subscriptions.expires_at>v_now then public.user_subscriptions.starts_at else v_now end,
    expires_at=case when public.user_subscriptions.expires_at is null then null
      else greatest(public.user_subscriptions.expires_at,v_now)+make_interval(days=>p_period_days) end,
    updated_at=v_now;
  return true;
end;
$function$;

create or replace function public.apply_flamexbot_referral(p_referrer_id uuid,p_referred_user_id uuid)
returns boolean language plpgsql security definer set search_path='public'
as $function$
declare v_lifetime boolean;
begin
  if p_referrer_id is null or p_referred_user_id is null or p_referrer_id=p_referred_user_id then return false;end if;
  if not exists(select 1 from public.profiles where id=p_referred_user_id and telegram_id is not null) then return false;end if;
  insert into public.flamexbot_referrals(referrer_id,referred_user_id) values(p_referrer_id,p_referred_user_id)
  on conflict(referred_user_id) do nothing;
  if not found then return false;end if;
  select exists(select 1 from public.user_subscriptions where user_id=p_referrer_id
    and plan in ('premium','pro','founder') and expires_at is null) into v_lifetime;
  if v_lifetime then
    update public.profiles set wheel_free_spins=wheel_free_spins+1 where id=p_referrer_id;
  else
    insert into public.user_subscriptions(user_id,plan,starts_at,expires_at,granted_by,updated_at)
    values(p_referrer_id,'premium',now(),now()+interval '1 day',p_referrer_id,now())
    on conflict(user_id) do update set
      plan=case when public.user_subscriptions.plan in ('pro','founder') then public.user_subscriptions.plan else 'premium' end,
      expires_at=greatest(coalesce(public.user_subscriptions.expires_at,now()),now())+interval '1 day',
      updated_at=now();
  end if;
  insert into public.notifications(user_id,type,title,body,data)
  values(p_referrer_id,'referral_reward','Реферальная награда',
    case when v_lifetime then 'За приглашённого участника начислена бесплатная прокрутка: бессрочный тариф уже активен.'
      else 'За приглашённого участника начислен 1 день Premium.' end,
    jsonb_build_object('referred_user_id',p_referred_user_id,'reward_days',case when v_lifetime then 0 else 1 end,'bonus_spin',v_lifetime));
  return true;
end;
$function$;

create or replace function public.claim_flamexbot_trial()
returns timestamptz language plpgsql security definer set search_path='public'
as $function$
declare v_user uuid:=auth.uid();v_exp timestamptz;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if exists(select 1 from public.profiles where id=v_user and is_banned) then raise exception 'Account is banned';end if;
  if exists(select 1 from public.flamexbot_trials where user_id=v_user) then raise exception 'Trial has already been used';end if;
  if exists(select 1 from public.user_subscriptions where user_id=v_user
    and plan in ('premium','pro','founder') and (expires_at is null or expires_at>now())) then
    raise exception 'An active subscription already exists';
  end if;
  v_exp:=now()+interval '3 days';
  insert into public.flamexbot_trials(user_id,expires_at) values(v_user,v_exp);
  insert into public.user_subscriptions(user_id,plan,starts_at,expires_at,granted_by,updated_at)
  values(v_user,'premium',now(),v_exp,v_user,now())
  on conflict(user_id) do update set plan='premium',starts_at=now(),expires_at=v_exp,granted_by=v_user,updated_at=now();
  insert into public.notifications(user_id,type,title,body,data)
  values(v_user,'trial_activated','Пробный Premium активирован','Тебе открыт Premium на 3 дня.',jsonb_build_object('expires_at',v_exp));
  return v_exp;
end;
$function$;

create extension if not exists pg_cron with schema pg_catalog;
do $schedule$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='flamexbot-weekly-wheel-spins' limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule('flamexbot-weekly-wheel-spins','7 0 * * 1',
    'select public.grant_flamexbot_weekly_wheel_spins();');
end;
$schedule$;
