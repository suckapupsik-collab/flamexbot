-- Keep verification separate from the single role badge slot.
CREATE OR REPLACE FUNCTION public.admin_manage_flamexbot_user(p_user_id uuid, p_action text, p_badge_code text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target public.profiles%rowtype;
  v_owner boolean;
  v_actor_owner boolean := auth.uid()='74a352c0-5a26-46a8-9b88-e71d0c3a9879'::uuid;
  v_target_privileged boolean;
  v_days integer := coalesce(p_days,30);
  v_current_plan text;
  v_current_expires timestamptz;
begin
  if not public.is_flamexbot_admin() then raise exception 'Administrator access required'; end if;
  select * into v_target from public.profiles where id=p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  v_owner := v_target.telegram_id='7781170049'
    or v_target.id='74a352c0-5a26-46a8-9b88-e71d0c3a9879'::uuid;
  select exists(select 1 from public.profile_badges b where b.user_id=p_user_id and b.badge_code in ('founder','developer','administrator'))
    into v_target_privileged;

  if not v_actor_owner and (v_owner or v_target_privileged or p_user_id=auth.uid()) then
    raise exception 'Только владелец может управлять привилегированными аккаунтами и своим аккаунтом';
  end if;

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
      if v_owner then raise exception 'The founder badge is protected'; end if;
      insert into public.profile_badges(user_id,badge_code,granted_by)
      values(p_user_id,'verified',auth.uid())
      on conflict(user_id,badge_code) do nothing;

    when 'unverify' then
      if v_owner then raise exception 'The founder badge is protected'; end if;
      delete from public.profile_badges where user_id=p_user_id and badge_code='verified';

    when 'premium_grant' then
      if v_owner then raise exception 'The owner PRO is protected'; end if;
      if v_days<0 or v_days>3650 then raise exception 'Premium duration must be between 0 and 3650 days'; end if;
      select plan,expires_at into v_current_plan,v_current_expires
      from public.user_subscriptions where user_id=p_user_id for update;
      if v_current_plan='pro' and (v_current_expires is null or v_current_expires>now()) then
        raise exception 'У пользователя уже активен PRO. Для продления выбери действие PRO.';
      end if;
      insert into public.user_subscriptions as current_subscription(user_id,plan,starts_at,expires_at,granted_by,updated_at)
      values(p_user_id,'premium',now(),case when v_days=0 then null else now()+make_interval(days=>v_days) end,auth.uid(),now())
      on conflict(user_id) do update set
        plan='premium',
        starts_at=case when current_subscription.plan='premium' and current_subscription.expires_at>now()
          then current_subscription.starts_at else now() end,
        expires_at=case
          when v_days=0 then null
          when current_subscription.plan='premium' and current_subscription.expires_at is null then null
          else greatest(coalesce(current_subscription.expires_at,now()),now())+make_interval(days=>v_days)
        end,
        granted_by=auth.uid(),updated_at=now();

    when 'premium_revoke' then
      if v_owner then raise exception 'The owner PRO cannot be revoked'; end if;
      if exists(select 1 from public.user_subscriptions where user_id=p_user_id and plan='pro') then
        raise exception 'У пользователя PRO. Для снятия используй действие «Снять PRO».';
      end if;
      delete from public.user_subscriptions where user_id=p_user_id and plan='premium';

    when 'pro_grant' then
      if v_owner then raise exception 'The owner PRO is protected'; end if;
      if v_days<0 or v_days>3650 then raise exception 'PRO duration must be between 0 and 3650 days'; end if;
      insert into public.user_subscriptions as current_subscription(user_id,plan,starts_at,expires_at,granted_by,updated_at)
      values(p_user_id,'pro',now(),case when v_days=0 then null else now()+make_interval(days=>v_days) end,auth.uid(),now())
      on conflict(user_id) do update set
        plan='pro',
        starts_at=case when current_subscription.expires_at>now()
          then current_subscription.starts_at else now() end,
        expires_at=case when v_days=0 then null
          when current_subscription.plan in ('premium','pro') and current_subscription.expires_at is null then null
          else greatest(coalesce(current_subscription.expires_at,now()),now())+make_interval(days=>v_days) end,
        granted_by=auth.uid(),updated_at=now();

    when 'pro_revoke' then
      if v_owner then raise exception 'The owner PRO cannot be revoked'; end if;
      update public.user_subscriptions set plan='premium',updated_at=now()
      where user_id=p_user_id and plan='pro' and (expires_at is null or expires_at>now());
      delete from public.user_subscriptions where user_id=p_user_id and plan='pro';

    when 'badge_grant' then
      if p_badge_code not in ('founder','developer','administrator','moderator','designer','creator','supporter','beta_tester','community_manager','partner','verified') then
        raise exception 'Unknown badge code';
      end if;
      if not v_actor_owner and p_badge_code in ('founder','developer','administrator') then
        raise exception 'Только владелец может выдавать привилегированные значки';
      end if;
      if v_owner and p_badge_code<>'founder' then raise exception 'The owner keeps the founder badge'; end if;
      if p_badge_code='founder' and not v_owner then raise exception 'Founder badge is reserved for the project owner'; end if;
      if p_badge_code='verified' then
        insert into public.profile_badges(user_id,badge_code,granted_by)
        values(p_user_id,'verified',auth.uid())
        on conflict(user_id,badge_code) do nothing;
      else
        delete from public.profile_badges where user_id=p_user_id and badge_code<>'verified';
        insert into public.profile_badges(user_id,badge_code,granted_by)
        values(p_user_id,p_badge_code,auth.uid());
      end if;

    when 'badge_revoke' then
      if v_owner then raise exception 'The founder badge is protected'; end if;
      if p_badge_code='verified' then raise exception 'Для снятия синей галочки используй действие unverify'; end if;
      if not v_actor_owner and p_badge_code in ('founder','developer','administrator') then
        raise exception 'Только владелец может снимать привилегированные значки';
      end if;
      delete from public.profile_badges where user_id=p_user_id and badge_code=p_badge_code;

    else
      raise exception 'Unsupported moderation action';
  end case;

  insert into public.flamexbot_admin_audit(actor_id,target_user_id,action,badge_code,reason,duration_days)
  values(auth.uid(),p_user_id,p_action,p_badge_code,nullif(trim(coalesce(p_reason,'')),''),case when p_action in ('premium_grant','pro_grant') then v_days else null end);

  return jsonb_build_object('ok',true,'user_id',p_user_id,'action',p_action,'badge_code',p_badge_code);
end;
$function$
;
