/**
 * Which sign-in failures must not be shown to the person typing.
 *
 * Access is invite-only, so Supabase refuses a link for anyone who is not
 * already a member. Passing that refusal through would make the form a
 * membership oracle: type an address, learn from the wording whether that person
 * works at this shop. For a product sold to shops with staff turnover and a
 * public storefront, that is a list worth harvesting.
 *
 * A malformed address is a different matter — it fails for everyone, reveals
 * nothing, and silently swallowing it would leave someone who typed `bob@gmial`
 * staring at a page saying a mail is on its way.
 */
const NOT_A_MEMBER = ['otp_disabled', 'signup_disabled', 'user_not_found', 'email_not_found'];

export function isUnknownAddress(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && NOT_A_MEMBER.includes(error.code)) return true;
  // Older Supabase releases carry no code on this one, only the message.
  return /signups not allowed/i.test(error.message ?? '');
}

/**
 * What the browser is told after an attempt.
 *
 * A function rather than a ternary in the page so the guarantee is testable
 * without a live Supabase: the whole point is that two of these inputs must
 * produce identical output, and that is not something to verify by eye.
 */
export function signInOutcome(error: { code?: string; message?: string } | null) {
  return !error || isUnknownAddress(error) ? 'sent=1' : 'error=1';
}
