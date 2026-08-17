/**
 * Sending mail.
 *
 * Resend over plain HTTPS rather than its SDK: this is one POST with a bearer
 * token, and a dependency for that is a dependency to keep patched forever.
 * Swapping provider means rewriting this one function.
 *
 * Nothing here throws on a missing key. A shop without mail configured must
 * still be able to invite someone — the invitation row is what grants access,
 * the email is only how the person finds out. What must never happen is the
 * owner being told a mail went out when none did, so the result says which
 * it was and the screen repeats it.
 */

export type SendResult =
  | { status: 'sent'; id: string }
  | { status: 'notConfigured' }
  | { status: 'failed'; reason: string };

export type Email = {
  to: string;
  subject: string;
  /** Both parts, always. A text-only client showing raw markup is a bad look. */
  html: string;
  text: string;
};

/** Whether mail can be sent at all. Screens use this to set expectations up front. */
export function mailIsConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendEmail(email: Email): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from) return { status: 'notConfigured' };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      // A slow mail provider must not hold a form submission open indefinitely.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // The body carries the useful part — a rejected domain, a bad key.
      const body = await response.text().catch(() => '');
      return { status: 'failed', reason: `${response.status} ${body.slice(0, 200)}` };
    }

    const data = (await response.json().catch(() => ({}))) as { id?: string };
    return { status: 'sent', id: data.id ?? '' };
  } catch (e) {
    return { status: 'failed', reason: e instanceof Error ? e.message : 'unknown' };
  }
}
