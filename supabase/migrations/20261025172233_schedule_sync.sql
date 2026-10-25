-- Schedules the `sync` Edge Function: Incremental Sync every 5 minutes, Full Sync every hour.
-- Needs two Vault secrets per environment (see README): `project_url` and `secret_key`.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.invoke_sync(kind public.sync_kind)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
    ),
    body := jsonb_build_object('kind', kind),
    timeout_milliseconds := 300000
  );
$$;

revoke execute on function private.invoke_sync(public.sync_kind) from public, anon, authenticated;

select cron.schedule('eonet-incremental-sync', '*/5 * * * *', $$select private.invoke_sync('incremental')$$);
select cron.schedule('eonet-full-sync', '0 * * * *', $$select private.invoke_sync('full')$$);
