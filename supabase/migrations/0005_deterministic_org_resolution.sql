-- -----------------------------------------------------------------------------
-- Make org resolution deterministic.
--
-- app.org_for_user picked a membership with `limit 1` and no ordering. With one
-- organization per user that is fine, and it was fine right up until seeding a
-- demo shop gave a real account two. Postgres is then free to return either row,
-- and which tenant you see could differ between requests — the same session
-- showing different shops is worse than showing the wrong one consistently.
--
-- Most recently joined wins. Someone added to a second organization almost
-- always means to be working in the new one, and it makes `pnpm seed` land where
-- it says it does.
--
-- This is not org switching. A user who genuinely belongs to several still sees
-- only one; the UI for choosing is a separate piece of work.
-- -----------------------------------------------------------------------------

create or replace function app.org_for_user(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select om.organization_id
  from public.organization_members om
  where om.user_id = p_user_id
  order by om.created_at desc, om.id desc
  limit 1;
$fn$;

revoke all on function app.org_for_user(uuid) from public;
grant execute on function app.org_for_user(uuid) to app_runtime;
