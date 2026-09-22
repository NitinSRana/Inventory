import { notFound } from 'next/navigation';

import { getSessionState } from '@/server/auth/session';

import { isPlatformAdmin } from './allowlist';

export { isPlatformAdmin };

/**
 * Guards every admin screen and every admin action.
 *
 * `notFound()`, not a redirect and not a 403: a signed-in shopkeeper who guesses
 * `/en/admin` should learn nothing, the same posture the sign-in and reset forms
 * take about which addresses exist.
 *
 * Deliberately does not call `requireOrg` — the platform owner may belong to no
 * shop at all, and the admin area has to work for exactly that person.
 */
export async function requirePlatformAdmin() {
  const session = await getSessionState();
  if (session.status === 'signedOut') notFound();
  if (!isPlatformAdmin(session.email, process.env.PLATFORM_ADMIN_EMAILS)) notFound();
  return session;
}
