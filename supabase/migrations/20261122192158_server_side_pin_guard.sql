-- Server-side PIN for the Mini App lock. Only the pin-guard edge function reads or writes it.
create table if not exists public.flamexbot_user_pins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  salt text not null,
  hash text not null,
  fails integer not null default 0 check (fails >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.flamexbot_user_pins enable row level security;
-- No policies: anon and authenticated roles get no access; the service role bypasses RLS.
revoke all on public.flamexbot_user_pins from anon, authenticated;
