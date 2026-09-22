-- -----------------------------------------------------------------------------
-- Access requests: how a shop gets onto the platform.
--
-- Until now the only way in was a human running scripts/create-org.mjs. Now a
-- stranger fills in the form on the landing page, the platform owner is emailed,
-- and the owner approves inside the app. Approval creates that shop — empty, its
-- own tenant — and invites the applicant as its owner.
--
-- Deliberately in the `app` schema, not `public`, and this is not taste:
-- 0002_app_runtime_role.sql grants every future table in `public` to app_runtime
-- by default privilege, so a tenant-less table there would be readable by any
-- request path that asked for it. In `app` the default privileges grant execute
-- on functions and nothing else, so the table is unreachable by construction and
-- every route into it is a function written here. Same reasoning as
-- app.rate_limits (0006).
--
-- What Postgres cannot do here: know who the platform owner is. The app connects
-- as app_runtime over plain Postgres with no JWT, so auth.uid() is null (see
-- 0002). Execute is therefore granted to app_runtime for all of these, and the
-- authorization lives in the TypeScript layer — src/server/platform/admins.ts,
-- checked at every entry point. That is the same trust model as
-- app.claim_invitation, which believes its p_user_id argument completely.
-- -----------------------------------------------------------------------------

create table app.signup_requests (
  id              uuid primary key default gen_random_uuid(),
  email           text not null check (position('@' in email) > 1),
  contact_name    text not null,
  shop_name       text not null,
  country_code    char(2) not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'declined')),
  -- The shop this request became. Deliberately no foreign key: approval claims
  -- the request first and builds the shop second, so that a crash in between
  -- leaves an id a retry rebuilds against rather than an orphan shop nobody can
  -- reach. A key here would reject the claim for a shop that does not exist yet
  -- — and would be checking the wrong thing anyway, since this is an audit note
  -- about what was decided, not a live reference.
  organization_id uuid,
  decided_at      timestamptz,
  decided_by      uuid,
  created_at      timestamptz not null default now()
);

-- One pending request per address, mirroring organization_invitations' own
-- pending-email index. Someone who submits the form twice leaves one row, which
-- is what makes the public form idempotent without it having to say so.
create unique index signup_requests_pending_email_key
  on app.signup_requests (lower(email)) where status = 'pending';

create index signup_requests_status_created_idx
  on app.signup_requests (status, created_at desc);

-- -----------------------------------------------------------------------------
-- Recording a request.
--
-- Returns nothing on purpose. A caller that learned whether the row was new
-- would be an oracle for "does this address already have a request", and the
-- public form's whole guarantee is that every address gets the same answer.
-- -----------------------------------------------------------------------------
create or replace function app.request_signup(
  p_email   text,
  p_name    text,
  p_shop    text,
  p_country text
)
returns void
language sql
security definer
set search_path = app, pg_temp
as $fn$
  insert into app.signup_requests (email, contact_name, shop_name, country_code)
  values (lower(trim(p_email)), trim(p_name), trim(p_shop), upper(p_country))
  on conflict do nothing;
$fn$;

create or replace function app.list_signup_requests(p_status text default null)
returns setof app.signup_requests
language sql
stable
security definer
set search_path = app, pg_temp
as $fn$
  select * from app.signup_requests
  where p_status is null or status = p_status
  order by created_at desc;
$fn$;

-- -----------------------------------------------------------------------------
-- Approving, atomically.
--
-- Returns the organization id the request is stored against: the one passed in
-- if this call is what approved it, the existing one if it was already approved.
-- That is what makes a double-click converge on one shop rather than build a
-- second — the caller adopts whatever comes back and rebuilds idempotently
-- against it. Returns null for a declined or unknown request, which the caller
-- must read as "do nothing".
-- -----------------------------------------------------------------------------
create or replace function app.claim_signup_request(
  p_id         uuid,
  p_org_id     uuid,
  p_decided_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $fn$
declare
  v_org uuid;
begin
  update app.signup_requests
  set status          = 'approved',
      organization_id = coalesce(organization_id, p_org_id),
      decided_at      = coalesce(decided_at, now()),
      decided_by      = coalesce(decided_by, p_decided_by)
  where id = p_id and status in ('pending', 'approved')
  returning organization_id into v_org;

  return v_org;
end;
$fn$;

create or replace function app.decline_signup_request(p_id uuid, p_decided_by uuid)
returns boolean
language plpgsql
security definer
set search_path = app, pg_temp
as $fn$
declare
  v_rows integer;
begin
  update app.signup_requests
  set status = 'declined', decided_at = now(), decided_by = p_decided_by
  where id = p_id and status = 'pending';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- Every shop on the platform, for the owner's admin screen.
--
-- Definer twice over: it reads every tenant's rows, which RLS forbids to
-- app_runtime, and it reads auth.users.last_sign_in_at, which app_runtime has no
-- grant on at all. "Invited but never signed in" is the single most useful fact
-- about a new shop, and there is no other way to learn it.
--
-- Built as dynamic SQL because the test clusters apply only
-- supabase/migrations/*.sql and so have no auth schema at all. Naming auth.users
-- statically would fail when this function is created and take the whole
-- migration run down with it; instead the join appears only where the table does.
-- -----------------------------------------------------------------------------
create or replace function app.platform_shops()
returns table (
  id              uuid,
  name            text,
  country_code    text,
  created_at      timestamptz,
  member_count    integer,
  product_count   integer,
  sale_count      integer,
  last_sale_at    timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $fn$
declare
  v_last_sign_in text;
begin
  v_last_sign_in := case
    when to_regclass('auth.users') is null then 'null::timestamptz'
    else '(select max(u.last_sign_in_at) from auth.users u
             join public.organization_members mu on mu.user_id = u.id
             where mu.organization_id = o.id)'
  end;

  return query execute format($q$
    select
      o.id,
      o.name,
      o.country_code::text,
      o.created_at,
      (select count(*)::int from public.organization_members m
         where m.organization_id = o.id),
      (select count(*)::int from public.products p
         where p.organization_id = o.id and p.is_active),
      (select count(*)::int from public.sales s
         where s.organization_id = o.id and s.status = 'completed'),
      (select max(s.created_at) from public.sales s
         where s.organization_id = o.id and s.status = 'completed'),
      %s
    from public.organizations o
    order by o.created_at desc
  $q$, v_last_sign_in);
end;
$fn$;

revoke all on function app.request_signup(text, text, text, text) from public;
revoke all on function app.list_signup_requests(text) from public;
revoke all on function app.claim_signup_request(uuid, uuid, uuid) from public;
revoke all on function app.decline_signup_request(uuid, uuid) from public;
revoke all on function app.platform_shops() from public;

grant execute on function app.request_signup(text, text, text, text) to app_runtime;
grant execute on function app.list_signup_requests(text) to app_runtime;
grant execute on function app.claim_signup_request(uuid, uuid, uuid) to app_runtime;
grant execute on function app.decline_signup_request(uuid, uuid) to app_runtime;
grant execute on function app.platform_shops() to app_runtime;
