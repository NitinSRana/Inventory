import type { Email } from './send';
import { escapeAttribute, escapeHtml } from './escape.ts';

/**
 * The two emails either side of an access request.
 *
 * The owner's notification carries what a stranger typed, so every field is
 * escaped. The applicant's decline is deliberately short and gives no reason —
 * the decision is the platform owner's and a paragraph of explanation invites an
 * argument about it.
 *
 * The approval email is accessApprovedEmail below. It used to reuse
 * invitationEmail(), but the two situations are not the same one: a staff
 * member invited by their own shop owner has no login at all and must use a
 * magic link, while an approved shop owner has one already — created by the
 * approval — and can be handed a link that sets its password.
 */

/**
 * The approval. Carries a one-time link that signs them in and asks them to
 * choose a password, so their first act is picking a credential rather than
 * hunting for a magic-link tab.
 *
 * `setPasswordUrl` is minted by passwordSetupLink() and delivered by Resend,
 * which is the point: onboarding no longer waits on Supabase's own mail. When
 * it could not be minted the caller passes the plain sign-in URL instead, and
 * the wording below still reads correctly for that case because it never
 * promises what is on the other end beyond "get in".
 */
export function accessApprovedEmail(input: {
  shopName: string;
  /** Absolute, because a relative link in an email goes nowhere. */
  setPasswordUrl: string;
}): Omit<Email, 'to'> {
  const { shopName, setPasswordUrl } = input;
  const subject = `${shopName} is ready`;

  const text = [
    `${shopName} has been approved and is ready for you.`,
    '',
    'Choose a password and sign in:',
    setPasswordUrl,
    '',
    'This link can only be used once and expires shortly. If it has expired,',
    'use "Forgot password" on the sign-in screen to get a new one.',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e6e6e3;border-radius:8px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;">${escapeHtml(shopName)}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
        <strong>${escapeHtml(shopName)}</strong> has been approved and is ready for you.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escapeAttribute(setPasswordUrl)}"
           style="display:inline-block;background:#1c1c1a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:15px;">
          Choose a password
        </a>
      </p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#6b6b66;">
        This link can only be used once and expires shortly. If it has expired, use
        &ldquo;Forgot password&rdquo; on the sign-in screen to get a new one.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

export function accessRequestEmail(input: {
  contactName: string;
  email: string;
  shopName: string;
  countryCode: string;
  /** Absolute, because a relative link in an email goes nowhere. */
  reviewUrl: string;
}): Omit<Email, 'to'> {
  const { contactName, email, shopName, countryCode, reviewUrl } = input;
  const subject = `Access request: ${shopName}`;

  const text = [
    `${contactName} has asked for access to the app.`,
    '',
    `Shop: ${shopName}`,
    `Country: ${countryCode}`,
    `Email: ${email}`,
    '',
    `Approve or decline: ${reviewUrl}`,
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#faf9f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c1c1e;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #eae8e4;border-radius:12px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;">${escapeHtml(shopName)}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
        <strong>${escapeHtml(contactName)}</strong> has asked for access to the app.
      </p>
      <table style="margin:0 0 24px;font-size:14px;line-height:1.6;border-collapse:collapse;">
        <tr><td style="padding-right:16px;color:#6b6b66;">Shop</td><td>${escapeHtml(shopName)}</td></tr>
        <tr><td style="padding-right:16px;color:#6b6b66;">Country</td><td>${escapeHtml(countryCode)}</td></tr>
        <tr><td style="padding-right:16px;color:#6b6b66;">Email</td><td>${escapeHtml(email)}</td></tr>
      </table>
      <p style="margin:0 0 24px;">
        <a href="${escapeAttribute(reviewUrl)}"
           style="display:inline-block;background:#1c1c1e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;">
          Review the request
        </a>
      </p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#6b6b66;">
        The link opens the admin area. You will need to be signed in — nothing is
        approved by clicking a link in an email.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

export function accessDeclinedEmail(input: { shopName: string }): Omit<Email, 'to'> {
  const { shopName } = input;
  const subject = `About your request for ${shopName}`;

  const text = [
    `Thank you for asking about the app for ${shopName}.`,
    '',
    'We are not able to set you up at the moment. If you think this was a',
    'mistake, reply to this message and we will take another look.',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#faf9f6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c1c1e;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #eae8e4;border-radius:12px;padding:24px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
        Thank you for asking about the app for <strong>${escapeHtml(shopName)}</strong>.
      </p>
      <p style="margin:0;font-size:15px;line-height:1.5;">
        We are not able to set you up at the moment. If you think this was a
        mistake, reply to this message and we will take another look.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}
