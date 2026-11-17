create table if not exists public.flamexbot_business_spam_consents (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  business_chat_id uuid not null references public.flamexbot_business_chats(id) on delete cascade,
  telegram_chat_id text not null,
  consented_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (profile_id, business_chat_id)
);

alter table public.flamexbot_business_spam_consents enable row level security;
revoke all on public.flamexbot_business_spam_consents from anon, authenticated;
grant all on public.flamexbot_business_spam_consents to service_role;
