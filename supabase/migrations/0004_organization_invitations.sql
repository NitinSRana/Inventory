-- -----------------------------------------------------------------------------
-- Invitations.
--
-- Roles only mean something once an organization has more than one person, and
-- until now the only way to create a membership was scripts/create-org.mjs.
--
-- The flow avoids the service_role key entirely: an owner records an invitation
-- against an email address, the person signs in with a magic link like anyone
-- else, and on first sign-in their pending invitation is claimed. Nothing
-- creates auth users on their behalf.
-- -----------------------------------------------------------------------------

create table public.organization_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null check (position('@' in email) > 1),
  role            text not null check (role in ('owner','manager','staff')),
  invited_by      uuid,
  accepted_at     timestamptz,
  accepted_by     uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Email is matched case-insensitively; store and compare folded.
create unique index organization_invitations_pending_email_key
  on public.organization_invitations (organization_id, lower(email))
  where accepted_at is null;

create index organization_invitations_email_idx
  on public.organization_invitations (lower(email)) where accepted_at is null;

create trigger organization_invitations_touch
  before update on public.organization_invitations
  for each row execute function app.touch_updated_at();

alter table public.organization_invitations enable row level security;
alter table public.organization_invitations force row level security;
create policy org_isolation on public.organization_invitations
  using (organization_id = app.current_org_id())
  with check (organization_id = app.current_org_id());

grant select, insert, update, delete on public.organization_invitations to app_runtime;

-- -----------------------------------------------------------------------------
-- Claiming an invitation.
--
-- Same chicken-and-egg as app.org_for_user: the caller has no organization yet,
-- so it cannot read an RLS-protected table to find the one inviting it. One
-- security definer function, search_path pinned, execute revoked from public.
--
-- Idempotent: claiming twice returns the same organization and does not create
-- a second membership.
-- -----------------------------------------------------------------------------

create or replace function app.claim_invitation(p_user_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_invite public.organization_invitations%rowtype;
begin
  if p_user_id is null or p_email is null or p_email = '' then
    return null;
  end if;

  -- Oldest pending invitation wins, so an accidental re-invite cannot jump the
  -- queue ahead of the one the owner actually meant.
  select * into v_invite
  from public.organization_invitations
  where lower(email) = lower(p_email) and accepted_at is null
  order by created_at asc
  limit 1;

  if not found then
    return null;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_invite.organization_id, p_user_id, v_invite.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations
  set accepted_at = now(), accepted_by = p_user_id
  where id = v_invite.id;

  return v_invite.organization_id;
end;
$fn$;

revoke all on function app.claim_invitation(uuid, text) from public;
grant execute on function app.claim_invitation(uuid, text) to app_runtime;
