alter table public.profiles
  add column if not exists command_protection_expires_at timestamptz;

create index if not exists profiles_command_protection_active_idx
  on public.profiles (telegram_id, command_protection_expires_at)
  where command_protection_expires_at is not null;

create table if not exists public.flamexbot_addon_star_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  telegram_user_id text not null,
  addon_code text not null check (addon_code = 'command_protection'),
  invoice_payload text not null unique,
  currency text not null default 'XTR' check (currency = 'XTR'),
  total_amount integer not null check (total_amount = 15),
  period_days integer not null default 5 check (period_days = 5),
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  valid_until timestamptz not null,
  telegram_payment_charge_id text unique,
  provider_payment_charge_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists flamexbot_addon_star_payments_user_idx
  on public.flamexbot_addon_star_payments (user_id, addon_code, created_at desc);

alter table public.flamexbot_addon_star_payments enable row level security;
revoke all on table public.flamexbot_addon_star_payments from public, anon, authenticated;
grant select, insert, update, delete on table public.flamexbot_addon_star_payments to service_role;

create table if not exists public.flamexbot_telegram_updates (
  update_id bigint primary key,
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists flamexbot_telegram_updates_created_idx
  on public.flamexbot_telegram_updates (created_at);

alter table public.flamexbot_telegram_updates enable row level security;
revoke all on table public.flamexbot_telegram_updates from public, anon, authenticated;
grant select, insert, update, delete on table public.flamexbot_telegram_updates to service_role;

create or replace function public.apply_flamexbot_command_protection_payment(
  p_invoice_payload text,
  p_telegram_user_id text,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text,
  p_currency text,
  p_total_amount integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.flamexbot_addon_star_payments%rowtype;
  v_expires_at timestamptz;
  v_now timestamptz := now();
begin
  if p_currency <> 'XTR' or p_total_amount <> 15
     or nullif(trim(coalesce(p_telegram_payment_charge_id,'')),'') is null
     or nullif(trim(coalesce(p_telegram_user_id,'')),'') is null
     or nullif(trim(coalesce(p_invoice_payload,'')),'') is null then
    raise exception 'Invalid command protection Telegram Stars payment';
  end if;

  select * into v_order
  from public.flamexbot_addon_star_payments
  where invoice_payload = p_invoice_payload
  for update;

  if not found then raise exception 'Command protection invoice was not found'; end if;
  if v_order.status = 'paid' then return false; end if;
  if v_order.status <> 'pending' then raise exception 'Command protection invoice is not payable'; end if;
  if v_order.addon_code <> 'command_protection'
     or v_order.currency <> p_currency
     or v_order.total_amount <> p_total_amount
     or v_order.period_days <> 5
     or v_order.telegram_user_id <> p_telegram_user_id then
    raise exception 'Command protection invoice does not match the payment';
  end if;

  select p.command_protection_expires_at
  into v_expires_at
  from public.profiles p
  where p.id = v_order.user_id
    and p.telegram_id = p_telegram_user_id
    and p.is_banned = false
  for update;

  if not found then raise exception 'Command protection account is unavailable'; end if;

  update public.flamexbot_addon_star_payments
  set status = 'paid',
      telegram_payment_charge_id = p_telegram_payment_charge_id,
      provider_payment_charge_id = p_provider_payment_charge_id,
      paid_at = v_now
  where id = v_order.id;

  update public.profiles
  set command_protection_expires_at =
        greatest(coalesce(v_expires_at, v_now), v_now) + interval '5 days',
      updated_at = v_now
  where id = v_order.user_id;

  return true;
end;
$function$;

revoke all on function public.apply_flamexbot_command_protection_payment(text,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.apply_flamexbot_command_protection_payment(text,text,text,text,text,integer) to service_role;

create or replace function public.claim_flamexbot_telegram_update(p_update_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claimed bigint;
begin
  if p_update_id is null or p_update_id < 0 then return false; end if;

  insert into public.flamexbot_telegram_updates(update_id,status,attempts,created_at,updated_at)
  values(p_update_id,'processing',1,now(),now())
  on conflict(update_id) do update
    set status='processing',
        attempts=public.flamexbot_telegram_updates.attempts+1,
        last_error=null,
        updated_at=now()
    where public.flamexbot_telegram_updates.status='failed'
       or (
         public.flamexbot_telegram_updates.status='processing'
         and public.flamexbot_telegram_updates.updated_at < now()-interval '2 minutes'
       )
  returning update_id into v_claimed;

  return v_claimed is not null;
end;
$function$;

create or replace function public.complete_flamexbot_telegram_update(p_update_id bigint)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.flamexbot_telegram_updates
  set status='completed',processed_at=now(),updated_at=now(),last_error=null
  where update_id=p_update_id and status='processing';
$function$;

create or replace function public.fail_flamexbot_telegram_update(p_update_id bigint,p_error text)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.flamexbot_telegram_updates
  set status='failed',last_error=left(coalesce(p_error,'Unknown webhook error'),1000),updated_at=now()
  where update_id=p_update_id and status='processing';
$function$;

revoke all on function public.claim_flamexbot_telegram_update(bigint) from public, anon, authenticated;
revoke all on function public.complete_flamexbot_telegram_update(bigint) from public, anon, authenticated;
revoke all on function public.fail_flamexbot_telegram_update(bigint,text) from public, anon, authenticated;
grant execute on function public.claim_flamexbot_telegram_update(bigint) to service_role;
grant execute on function public.complete_flamexbot_telegram_update(bigint) to service_role;
grant execute on function public.fail_flamexbot_telegram_update(bigint,text) to service_role;
