create table if not exists public.flamexbot_support_chats (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id text not null unique,
  telegram_user_id text not null,
  username text,
  first_name text,
  last_name text,
  last_message_preview text not null default '',
  last_message_at timestamptz not null default now(),
  unread_count integer not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flamexbot_support_messages (
  id uuid primary key default gen_random_uuid(),
  support_chat_id uuid not null references public.flamexbot_support_chats(id) on delete cascade,
  telegram_message_id bigint not null,
  direction text not null check (direction in ('incoming','outgoing')),
  content text not null default '',
  message_type text not null default 'text',
  sender_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (support_chat_id, telegram_message_id)
);

create index if not exists flamexbot_support_chats_last_message_idx
  on public.flamexbot_support_chats(last_message_at desc);
create index if not exists flamexbot_support_messages_chat_created_idx
  on public.flamexbot_support_messages(support_chat_id, created_at asc);

alter table public.flamexbot_support_chats enable row level security;
alter table public.flamexbot_support_messages enable row level security;
revoke all on public.flamexbot_support_chats from anon, authenticated;
revoke all on public.flamexbot_support_messages from anon, authenticated;
grant all on public.flamexbot_support_chats to service_role;
grant all on public.flamexbot_support_messages to service_role;