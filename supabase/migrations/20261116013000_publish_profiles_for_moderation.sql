-- Publish profile changes so active sessions can be blocked immediately after an admin ban.
alter publication supabase_realtime add table public.profiles;
