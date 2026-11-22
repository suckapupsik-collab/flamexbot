-- Dedicated, randomly generated authentication for the FLAMEXBOT .time scheduler.
-- The credential remains in Vault; pg_cron reads it at execution time and the Edge
-- Function validates candidates through a service-role-only RPC.
create extension if not exists pg_net;

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'FLAMEXBOT_TIME_TICK_SECRET'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'FLAMEXBOT_TIME_TICK_SECRET',
      'Independent authentication token for the FLAMEXBOT .time minute scheduler'
    );
  end if;
end
$$;

create or replace function public.verify_flamexbot_time_tick_secret(p_candidate text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, extensions, vault
as $function$
  select p_candidate is not null
    and p_candidate ~ '^[0-9a-f]{64}$'
    and exists (
      select 1
      from vault.decrypted_secrets as s
      where s.name = 'FLAMEXBOT_TIME_TICK_SECRET'
        and extensions.digest(p_candidate, 'sha256')
          = extensions.digest(s.decrypted_secret, 'sha256')
    );
$function$;

revoke all on function public.verify_flamexbot_time_tick_secret(text) from public, anon, authenticated;
grant execute on function public.verify_flamexbot_time_tick_secret(text) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'flamexbot-time-tick';

select cron.schedule(
  'flamexbot-time-tick',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://yxmfhnbqzudoiwjlrpui.supabase.co/functions/v1/flamexbot-bot',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-flamexbot-job', 'time-tick',
        'x-flamexbot-job-secret',
          (select decrypted_secret
             from vault.decrypted_secrets
            where name = 'FLAMEXBOT_TIME_TICK_SECRET'
            limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);
