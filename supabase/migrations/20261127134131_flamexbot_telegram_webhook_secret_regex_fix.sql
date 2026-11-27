create or replace function public.verify_flamexbot_telegram_webhook_secret(p_candidate text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, extensions, vault
as $function$
  select p_candidate is not null
    and length(p_candidate) between 1 and 256
    and p_candidate ~ '^[A-Za-z0-9_-]+$'
    and exists (
      select 1
      from vault.decrypted_secrets s
      where (
        s.name = 'FLAMEXBOT_TELEGRAM_WEBHOOK_SECRET'
        and extensions.digest(p_candidate, 'sha256')
          = extensions.digest(s.decrypted_secret, 'sha256')
      ) or (
        s.name = 'FLAMEXBOT_TELEGRAM_WEBHOOK_LEGACY_HASH'
        and encode(extensions.digest(p_candidate, 'sha256'), 'hex') = s.decrypted_secret
      )
    );
$function$;

revoke all on function public.verify_flamexbot_telegram_webhook_secret(text) from public, anon, authenticated;
grant execute on function public.verify_flamexbot_telegram_webhook_secret(text) to service_role;
