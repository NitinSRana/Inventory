import type { Email } from './send';

/**
 * The invitation email.
 *
 * Pure: it takes strings and returns strings, so it can be read and tested
 * without a network or a template engine. One email does not justify a
 * rendering framework.
 *
 * Deliberately plain. It is a doorway, not a newsletter — no images, no
 * tracking, no hero. Half of these arrive on a phone in a stockroom, and a
 * layout that needs a wide screen is a layout that fails there.
 */
export function invitationEmail(input: {
  /** The shop, so a person invited to two of them can tell which is which. */
  organizationName: string;
  /** Absolute, because a relative link in an email goes nowhere. */
  signInUrl: string;
  /** Named so the recipient knows this was a person, not a robot. */
  invitedByEmail?: string | null;
}): Omit<Email, 'to'> {
  const { organizationName, signInUrl, invitedByEmail } = input;

  const from = invitedByEmail ? ` by ${invitedByEmail}` : '';
  const subject = `You have been added to ${organizationName}`;

  const text = [
    `You have been added to ${organizationName}${from}.`,
    '',
    'Sign in here:',
    signInUrl,
    '',
    'Use the same email address this message was sent to. If you do not have a',
    'password yet, leave the password box empty and it will email you a sign-in link.',
  ].join('\n');

  // Inline styles and a table-free layout: mail clients strip stylesheets, and
  // a single column survives every one of them.
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e6e6e3;border-radius:8px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;">${escapeHtml(organizationName)}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
        You have been added to <strong>${escapeHtml(organizationName)}</strong>${
          invitedByEmail ? ` by ${escapeHtml(invitedByEmail)}` : ''
        }.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escapeAttribute(signInUrl)}"
           style="display:inline-block;background:#1c1c1a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:15px;">
          Sign in
        </a>
      </p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#6b6b66;">
        Use the same email address this message was sent to. No password yet? Leave
        the password box empty and we will email you a sign-in link.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

/**
 * A shop is named by its owner, so its name is untrusted input — an apostrophe
 * is likely and a script tag is possible.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** As above, plus the quote that would otherwise end the attribute early. */
function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
