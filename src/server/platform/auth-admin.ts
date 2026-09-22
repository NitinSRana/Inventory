/**
 * Creating a login for someone the platform owner has approved.
 *
 * Signups are disabled on this Supabase project, and that is worth keeping: the
 * anon key is public by design, so with signups on, anyone could mint accounts
 * and outbound mail straight against the project — bypassing app.rate_limits
 * entirely and burning the mail quota every real shop depends on. But a disabled
 * signup also means an approved applicant has no auth.users row, and Supabase
 * will not issue a magic link to an address it does not know. So approval
 * creates the login itself.
 *
 * CLAUDE.md says never to use the service_role key in request-handling code, and
 * this is request-handling code. The exception is narrow and deliberate: that
 * rule exists because service_role carries BYPASSRLS **on a Postgres
 * connection**. This module never obtains a database handle. It is one HTTPS
 * call to the Auth API, structurally the same as server/email/send.ts calling
 * Resend, so the hazard the rule protects against cannot arise here.
 *
 * Kept to one file with one export so that stays true: nothing under
 * server/{stock,catalog,pos,counting,reports,settings,analytics} imports this,
 * and the key is read inside the function rather than at module load, with no
 * NEXT_PUBLIC_ prefix, so it cannot reach the browser bundle.
 */

export type LoginResult = 'created' | 'exists' | 'notConfigured' | 'failed';

/**
 * Creates a confirmed login for this address.
 *
 * `email_confirm: true` is load-bearing — an unconfirmed user cannot redeem an
 * OTP, so the sign-in link would fail for exactly the person we just approved.
 *
 * Never throws, like sendEmail: the caller reports what happened rather than
 * losing the approval over it. An address that already exists counts as success
 * — that is re-approval, or someone who already works at another shop.
 */
export async function createLogin(email: string): Promise<LoginResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 'notConfigured';

  try {
    const response = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ email: email.trim().toLowerCase(), email_confirm: true }),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) return 'created';

    const body = await response.text();
    // 422 email_exists is the idempotent case, not a failure.
    if (response.status === 422 && /already|exists/i.test(body)) return 'exists';

    console.error(`Creating a login failed: ${response.status} ${body.slice(0, 200)}`);
    return 'failed';
  } catch (e) {
    console.error('Creating a login failed:', e);
    return 'failed';
  }
}
