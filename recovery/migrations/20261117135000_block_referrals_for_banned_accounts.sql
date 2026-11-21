-- Block referral code creation and rewards for banned accounts.
CREATE OR REPLACE FUNCTION public.apply_flamexbot_referral(p_referrer_id uuid, p_referred_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_lifetime boolean;
begin
  if p_referrer_id is null or p_referred_user_id is null or p_referrer_id=p_referred_user_id then return false;end if;
  if not exists(select 1 from public.profiles where id=p_referred_user_id and telegram_id is not null and is_banned=false) then return false;end if;
  if not exists(select 1 from public.profiles where id=p_referrer_id and is_banned=false) then return false;end if;
  insert into public.flamexbot_referrals(referrer_id,referred_user_id) values(p_referrer_id,p_referred_user_id)
  on conflict(referred_user_id) do nothing;
  if not found then return false;end if;
  select exists(select 1 from public.user_subscriptions where user_id=p_referrer_id
    and plan in ('premium','pro') and expires_at is null) into v_lifetime;
  if v_lifetime then
    update public.profiles set wheel_free_spins=wheel_free_spins+1 where id=p_referrer_id;
  else
    insert into public.user_subscriptions(user_id,plan,starts_at,expires_at,granted_by,updated_at)
    values(p_referrer_id,'premium',now(),now()+interval '1 day',p_referrer_id,now())
    on conflict(user_id) do update set
      plan=case when public.user_subscriptions.plan='pro' then 'pro' else 'premium' end,
      expires_at=greatest(coalesce(public.user_subscriptions.expires_at,now()),now())+interval '1 day',
      updated_at=now();
  end if;
  insert into public.notifications(user_id,type,title,body,data)
  values(p_referrer_id,'referral_reward','Реферальная награда',
    case when v_lifetime then 'За приглашённого участника начислена бесплатная прокрутка: бессрочный PRO уже активен.'
      else 'За приглашённого участника начислен 1 день Premium.' end,
    jsonb_build_object('referred_user_id',p_referred_user_id,'reward_days',case when v_lifetime then 0 else 1 end,'bonus_spin',v_lifetime));
  return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_flamexbot_referral_code(p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_user uuid:=auth.uid();v_telegram text;v_referrer uuid;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 if not public.is_flamexbot_user_active() then raise exception 'Account is not active';end if;
 select telegram_id into v_telegram from public.profiles where id=v_user;
 if v_telegram is null then raise exception 'Link Telegram before using a referral code';end if;
 select user_id into v_referrer from public.flamexbot_referral_codes where code=upper(trim(p_code));
 if v_referrer is null then raise exception 'Referral code not found';end if;
 return public.apply_flamexbot_referral(v_referrer,v_user);
end $function$
;
CREATE OR REPLACE FUNCTION public.ensure_flamexbot_referral_code()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_flamexbot_user_active() then raise exception 'Account is not active'; end if;
  select code into v_code from public.flamexbot_referral_codes where user_id=auth.uid();
  if v_code is null then
    v_code := upper(substr(encode(gen_random_bytes(8),'hex'),1,10));
    insert into public.flamexbot_referral_codes(user_id,code) values(auth.uid(),v_code)
    on conflict(user_id) do update set code=excluded.code returning code into v_code;
  end if;
  return v_code;
end $function$
;
