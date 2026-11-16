-- Archive previous versions of incoming Telegram Business messages.
create table if not exists public.flamexbot_business_message_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  business_chat_id uuid not null references public.flamexbot_business_chats(id) on delete cascade,
  telegram_message_id bigint not null,
  event_type text not null check (event_type in ('deleted','edited')),
  original_content text not null default '',
  message_type text not null default 'text',
  media_file_id text,
  media_url text,
  original_raw jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint flamexbot_business_message_events_unique
    unique (business_chat_id, telegram_message_id, event_type, occurred_at)
);
create index if not exists flamexbot_business_message_events_owner_idx
  on public.flamexbot_business_message_events(profile_id, event_type, occurred_at desc);
create index if not exists flamexbot_business_message_events_chat_idx
  on public.flamexbot_business_message_events(business_chat_id, occurred_at desc);
alter table public.flamexbot_business_message_events enable row level security;
grant select on public.flamexbot_business_message_events to authenticated;
drop policy if exists "Users can read own Business message events" on public.flamexbot_business_message_events;
create policy "Users can read own Business message events"
  on public.flamexbot_business_message_events
  for select to authenticated
  using (profile_id = (select auth.uid()) and is_flamexbot_user_active());
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename='flamexbot_business_message_events'
  ) then
    alter publication supabase_realtime add table public.flamexbot_business_message_events;
  end if;
end $$;
