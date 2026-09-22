/**
 * Who runs the platform, as opposed to who runs a shop.
 *
 * Every other permission in this product is a role inside one tenant
 * (ROLE_RANK in server/auth/roles.ts). This is the one question above that: may
 * this person see every shop, and approve strangers onto the platform.
 *
 * An environment allowlist rather than a column, deliberately. Nothing in the
 * database grants it, so no tenant can write themselves into it and no
 * organization_members bug can widen it. Adding a colleague is a change to one
 * variable.
 *
 * Kept apart from admins.ts, which reaches for the session and Next's
 * navigation, so the matching rules stay unit-testable on their own.
 */
/**
 * Pure, so the matching rules can be tested without a request or a session.
 *
 * Exact matches only, after trimming and lowercasing. Substring matching here
 * would be a hole: `nitin@logicbevers.com.attacker.example` contains the real
 * address, and an attacker who can register that domain should not inherit the
 * platform.
 *
 * An empty or missing allowlist returns false for everyone — a deployment that
 * forgot the variable has no admin area at all, rather than one open to the
 * first person who guesses the URL.
 */
export function isPlatformAdmin(
  email: string | null | undefined,
  allowlist: string | null | undefined,
): boolean {
  if (!email || !allowlist) return false;
  const wanted = email.trim().toLowerCase();
  if (!wanted) return false;

  return allowlist
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(wanted);
}
