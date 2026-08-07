import { orgForUser } from '@/db/tenant';
import { createClient } from '@/lib/supabase/server';

export type SessionContext = {
  userId: string;
  email: string;
  orgId: string;
};

/**
 * Resolves the caller's user and organization. Returns null when signed out, or
 * when the account exists but belongs to no organization — the state every
 * newly invited user is in until an owner adds them.
 *
 * orgId comes from the session, never from the client. It is the only value
 * withTenant should ever be given.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const orgId = await orgForUser(user.id);
  if (!orgId) return null;

  return { userId: user.id, email: user.email ?? '', orgId };
}
