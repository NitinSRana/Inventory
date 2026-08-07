-- -----------------------------------------------------------------------------
-- The role the application connects as.
--
-- Supabase's `postgres` role has BYPASSRLS, so connecting the app as `postgres`
-- silently disables every policy in 0001_init.sql: a query that forgets
-- withTenant() returns every tenant's rows instead of none. app_runtime has no
-- such attribute, which is what makes rule 1 in CLAUDE.md enforceable rather
-- than advisory.
--
-- No password here on purpose — it is set out of band and lives only in
-- .env.local. Migrations are committed; passwords are not.
-- -----------------------------------------------------------------------------

do $mig$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime login nobypassrls;
  end if;
end
$mig$;

grant usage on schema public, app to app_runtime;
grant select, insert, update, delete on all tables in schema public to app_runtime;
grant execute on all functions in schema app to app_runtime;

alter default privileges in schema public
  grant select, insert, update, delete on tables to app_runtime;
alter default privileges in schema app
  grant execute on functions to app_runtime;

-- -----------------------------------------------------------------------------
-- Session bootstrap.
--
-- Resolving "which org is this user in?" is a chicken-and-egg: organization_members
-- is itself RLS-protected by organization_id, so app_runtime cannot read it until
-- it already knows the org. app.current_org_id() has an auth.uid() fallback for
-- Supabase's JWT roles, but the app connects over plain Postgres where auth.uid()
-- is null.
--
-- security definer, with search_path pinned and execute revoked from public, so
-- the bypass is exactly one function with one job.
-- -----------------------------------------------------------------------------

create or replace function app.org_for_user(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  -- ponytail: one org per user. Returns an arbitrary row if a user ever joins
  -- two; revisit when multi-org membership is a real requirement.
  select om.organization_id
  from public.organization_members om
  where om.user_id = p_user_id
  limit 1;
$fn$;

revoke all on function app.org_for_user(uuid) from public;
grant execute on function app.org_for_user(uuid) to app_runtime;
