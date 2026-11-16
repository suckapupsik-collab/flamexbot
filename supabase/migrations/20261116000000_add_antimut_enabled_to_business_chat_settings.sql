-- Add per-chat antimut mode. Safe to apply more than once.
alter table public.flamexbot_business_chat_settings
  add column if not exists antimut_enabled boolean not null default false;
