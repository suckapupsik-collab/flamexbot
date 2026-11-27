-- Move the Telegram webhook credential out of the public repository.
-- A SHA-256 compatibility hash is kept only until Telegram acknowledges setWebhook with the Vault-backed token.
do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'FLAMEXBOT_TELEGRAM_WEBHOOK_SECRET'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'FLAMEXBOT_TELEGRAM_WEBHOOK_SECRET',
      'Private Telegram webhook secret used by FLAMEXBOT Edge Functions'
    );
  end if;

  if not exists (
    select 1 from vault.secrets where name = 'FLAMEXBOT_TELEGRAM_WEBHOOK_LEGACY_HASH'
  ) then
    perform vault.create_secret(
      '9ac8b05f009b85ae9e596fcf7bf4e5e7258e53b433875f3a74d8a0fbd08bddf1',
      'FLAMEXBOT_TELEGRAM_WEBHOOK_LEGACY_HASH',
      'SHA-256 compatibility hash retired automatically after webhook rotation'
    );
  end if;
end
$$;

create or replace function public.get_flamexbot_telegram_webhook_secret()
returns text
language sql
stable
security definer
set search_path = pg_catalog, vault
as $function$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = 'FLAMEXBOT_TELEGRAM_WEBHOOK_SECRET'
  limit 1;
$function$;

create or replace function public.verify_flamexbot_telegram_webhook_secret(p_candidate text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, extensions, vault
as $function$
  select p_candidate is not null
    and p_candidate ~ '^[A-Za-z0-9_-]{1,256}$'
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

create or replace function public.retire_flamexbot_telegram_webhook_legacy_secret()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions, vault
as $function$
declare
  v_secret_id uuid;
begin
  select id into v_secret_id
  from vault.secrets
  where name = 'FLAMEXBOT_TELEGRAM_WEBHOOK_LEGACY_HASH'
  limit 1;

  if v_secret_id is null then
    return true;
  end if;

  perform vault.update_secret(
    v_secret_id,
    encode(extensions.gen_random_bytes(32), 'hex'),
    'FLAMEXBOT_TELEGRAM_WEBHOOK_LEGACY_HASH',
    'Retired after Telegram accepted the Vault-backed webhook secret'
  );
  return true;
end;
$function$;

revoke all on function public.get_flamexbot_telegram_webhook_secret() from public, anon, authenticated;
revoke all on function public.verify_flamexbot_telegram_webhook_secret(text) from public, anon, authenticated;
revoke all on function public.retire_flamexbot_telegram_webhook_legacy_secret() from public, anon, authenticated;
grant execute on function public.get_flamexbot_telegram_webhook_secret() to service_role;
grant execute on function public.verify_flamexbot_telegram_webhook_secret(text) to service_role;
grant execute on function public.retire_flamexbot_telegram_webhook_legacy_secret() to service_role;
