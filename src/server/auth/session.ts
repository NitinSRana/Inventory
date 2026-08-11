import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { organizationMembers } from '@/db/schema';
import { claimInvitation, orgForUser, withTenant } from '@/db/tenant';
import { createClient } from '@/lib/supabase/server';

import { roleAtLeast, type Role } from './roles';

/**
 * Signed out, signed in but not yet a member of anything, or ready to query.
 * The middle state is where every invited user sits until an owner adds them,
 * and it needs its own screen rather than looking like a failure.
 */
export type SessionState =
  | { status: 'signedOut' }
  | { status: 'noOrganization'; userId: string; email: string }
  | { status: 'ready'; userId: string; email: string; orgId: string; role: string };

/**
 * Resolves the caller's user, organization and role.
 *
 * Wrapped in React cache(): the shell layout resolves the session and so does
 * every page inside it, which meant three round trips happening twice per
 * request. cache() dedupes within a single request only — it is not a cross-
 * request cache, so one tenant can never be served another tenant's session.
 *
 * orgId comes from the session, never from the client, and is the only value
 * withTenant should ever be given.
 */
export const getSessionState = cache(async function getSessionState(): Promise<SessionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'signedOut' };

  const email = user.email ?? '';
  // A pending invitation is claimed on first sign-in, so an invited person never
  // sees the "not a member of anything" screen at all.
  const orgId = (await orgForUser(user.id)) ?? (await claimInvitation(user.id, email));
  if (!orgId) return { status: 'noOrganization', userId: user.id, email };

  // Safe to read normally now: with org context set, RLS scopes this to the
  // caller's own tenant.
  const [membership] = await withTenant(orgId, (tx) =>
    tx
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id))
      .limit(1),
  );

  return { status: 'ready', userId: user.id, email, orgId, role: membership?.role ?? '' };
});

/**
 * For pages that cannot render without a tenant. Sends anyone who is signed out
 * to sign-in, and anyone without a membership home, where that state has its own
 * explanation rather than looking like an error.
 */
export async function requireOrg(locale: string) {
  const session = await getSessionState();
  if (session.status === 'signedOut') redirect(`/${locale}/sign-in`);
  if (session.status === 'noOrganization') redirect(`/${locale}`);
  return session;
}

/**
 * As requireOrg, but also demands a minimum role.
 *
 * Call this inside the server action too, not only in the page that renders the
 * button. Hiding a control is presentation; a check that only runs at render is
 * bypassed by posting the action directly.
 */
export async function requireRole(locale: string, required: Role) {
  const session = await requireOrg(locale);
  if (!roleAtLeast(session.role, required)) redirect(`/${locale}?denied=${required}`);
  return session;
}

export { roleAtLeast, type Role } from './roles';
