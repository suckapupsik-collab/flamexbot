create table if not exists public.flamexbot_business_flood_windows (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  business_chat_id uuid not null references public.flamexbot_business_chats(id) on delete cascade,
  sender_telegram_id text not null,
  window_started_at timestamptz not null default now(),
  message_count integer not null default 0 check (message_count >= 0),
  triggered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, business_chat_id, sender_telegram_id)
);

alter table public.flamexbot_business_flood_windows enable row level security;
revoke all on table public.flamexbot_business_flood_windows from public, anon, authenticated;
grant all on table public.flamexbot_business_flood_windows to service_role;

create or replace function public.record_flamexbot_business_flood(
  p_profile_id uuid,
  p_business_chat_id uuid,
  p_sender_telegram_id text,
  p_now timestamptz default now()
)
returns table(message_count integer, triggered boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
  v_triggered_at timestamptz;
  v_triggered boolean := false;
begin
  insert into public.flamexbot_business_flood_windows (
    profile_id, business_chat_id, sender_telegram_id, window_started_at, message_count, triggered_at, updated_at
  ) values (p_profile_id, p_business_chat_id, p_sender_telegram_id, p_now, 1, null, p_now)
  on conflict (profile_id, business_chat_id, sender_telegram_id)
  do update set
    window_started_at = case
      when public.flamexbot_business_flood_windows.window_started_at <= p_now - interval '2 seconds'
      then p_now else public.flamexbot_business_flood_windows.window_started_at end,
    message_count = case
      when public.flamexbot_business_flood_windows.window_started_at <= p_now - interval '2 seconds'
      then 1 else public.flamexbot_business_flood_windows.message_count + 1 end,
    triggered_at = case
      when public.flamexbot_business_flood_windows.window_started_at <= p_now - interval '2 seconds'
      then null else public.flamexbot_business_flood_windows.triggered_at end,
    updated_at = p_now
  returning public.flamexbot_business_flood_windows.message_count,
            public.flamexbot_business_flood_windows.triggered_at
  into v_count, v_triggered_at;

  if v_count >= 10 and v_triggered_at is null then
    update public.flamexbot_business_flood_windows
      set triggered_at = p_now, updated_at = p_now
      where profile_id = p_profile_id and business_chat_id = p_business_chat_id
        and sender_telegram_id = p_sender_telegram_id and triggered_at is null;
    v_triggered := found;
  end if;
  return query select v_count, v_triggered;
end;
$$;

revoke all on function public.record_flamexbot_business_flood(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_flamexbot_business_flood(uuid, uuid, text, timestamptz) to service_role;