import { redirect } from 'next/navigation';

import { orgForUser } from '@/db/tenant';
import { createClient } from '@/lib/supabase/server';

/**
 * Signed out, signed in but not yet a member of anything, or ready to query.
 * The middle state is where every invited user sits until an owner adds them,
 * and it needs its own screen rather than looking like a failure.
 */
export type SessionState =
  | { status: 'signedOut' }
  | { status: 'noOrganization'; userId: string; email: string }
  | { status: 'ready'; userId: string; email: string; orgId: string };

/**
 * Resolves the caller's user and organization.
 *
 * orgId comes from the session, never from the client, and is the only value
 * withTenant should ever be given.
 */
export async function getSessionState(): Promise<SessionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'signedOut' };

  const email = user.email ?? '';
  const orgId = await orgForUser(user.id);
  if (!orgId) return { status: 'noOrganization', userId: user.id, email };

  return { status: 'ready', userId: user.id, email, orgId };
}

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
