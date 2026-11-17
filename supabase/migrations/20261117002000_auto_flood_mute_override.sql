alter table public.flamexbot_business_chat_settings
  add column if not exists auto_flood_muted boolean not null default false;