-- Restore the founder account to the product's Premium tier.
-- Both legacy owner triggers previously rewrote the plan to "pro".

create or replace function public.keep_flamexbot_founder_subscription()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_owner_id uuid;
begin
  select p.id into v_owner_id from public.profiles p
  where p.telegram_id = '7781170049' limit 1;
  if v_owner_id is not null and new.user_id = v_owner_id then
    new.plan := 'premium';
    new.expires_at := null;
    new.updated_at := now();
  end if;
  return new;
end;
$function$;

create or replace function public.keep_flamexbot_owner_max_subscription()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_owner_id uuid;
begin
  select p.id into v_owner_id from public.profiles p
  where p.telegram_id = '7781170049'
     or p.id = '74a352c0-5a26-46a8-9b88-e71d0c3a9879'::uuid
  order by case when p.telegram_id = '7781170049' then 0 else 1 end
  limit 1;
  if v_owner_id is not null and new.user_id = v_owner_id then
    new.plan := 'premium';
    new.expires_at := null;
    if new.starts_at is null then new.starts_at := now(); end if;
    new.updated_at := now();
  end if;
  return new;
end;
$function$;

update public.user_subscriptions s
set plan = 'premium', expires_at = null, updated_at = now()
from public.profiles p
where s.user_id = p.id and p.telegram_id = '7781170049';
