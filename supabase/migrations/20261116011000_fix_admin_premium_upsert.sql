-- Keep Premium extension upserts compatible with PostgreSQL's ON CONFLICT target alias.
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
      on conflict(user_id) do update set plan='premium',starts_at=now(),
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
revoke all on function public.admin_manage_flamexbot_user(uuid,text,text,text,integer) from public,anon;
grant execute on function public.admin_manage_flamexbot_user(uuid,text,text,text,integer) to authenticated;
