'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  ACCESS_REQUEST_PER_CLIENT,
  ACCESS_REQUEST_PER_EMAIL,
  checkRateLimit,
  hashedBucket,
} from '@/server/auth/rate-limit';
import { safeRedirectPath } from '@/server/auth/redirect';
import { accessRequestEmail } from '@/server/email/access-request';
import { sendEmail } from '@/server/email/send';
import { submitRequest } from '@/server/platform/signup-requests';
import { SEEDED_COUNTRIES } from '@/server/settings/vat-seeds';

/**
 * Someone asking for a shop on the platform.
 *
 * Shared by the landing page and the standalone request page, so `back` says
 * which one to return to — run through safeRedirectPath, because a form field
 * is something anyone can craft and this would otherwise be an open redirect.
 *
 * The answer is identical whatever the address: new, already queued, already
 * approved, or a member of an existing shop. Nothing here branches on it, and
 * submitRequest deliberately returns nothing to keep that true.
 */
export async function requestAccess(formData: FormData) {
  const locale = String(formData.get('locale') ?? 'en');
  const h = await headers();
  const origin =
    h.get('origin') ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    `http://${h.get('host') ?? 'localhost:3000'}`;

  const back = safeRedirectPath(
    String(formData.get('back') ?? ''),
    origin,
    `/${locale}/request-access`,
  );

  const email = String(formData.get('email') ?? '').trim();
  const contactName = String(formData.get('contactName') ?? '').trim();
  const shopName = String(formData.get('shopName') ?? '').trim();
  const countryCode = String(formData.get('countryCode') ?? '').trim().toUpperCase();

  // A country we cannot seed VAT rates for would leave the shop unable to sell
  // correctly on day one, so it is not offered and not accepted.
  const known = (SEEDED_COUNTRIES as readonly string[]).includes(countryCode);
  if (!email.includes('@') || !contactName || !shopName || !known) {
    redirect(`${back}?requestError=1`);
  }

  const client = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const checks = await Promise.all([
    checkRateLimit(await hashedBucket('access-request-email', email), ACCESS_REQUEST_PER_EMAIL),
    checkRateLimit(await hashedBucket('access-request-client', client), ACCESS_REQUEST_PER_CLIENT),
  ]);
  // Both refuse, but a check that could not run is our fault and does not clear
  // by waiting — telling someone to wait is a dead end there.
  if (checks.includes('unavailable')) redirect(`${back}?requestError=unavailable`);
  if (checks.includes('limited')) redirect(`${back}?requestError=throttled`);

  await submitRequest({ email, contactName, shopName, countryCode });

  // The row is what the owner acts on; the email is only how they find out.
  // A mail failure is logged and never changes what the applicant is told.
  const owner = process.env.PLATFORM_ADMIN_EMAILS?.split(',')[0]?.trim();
  if (owner) {
    const result = await sendEmail({
      to: owner,
      ...accessRequestEmail({
        contactName,
        email,
        shopName,
        countryCode,
        reviewUrl: `${origin}/${locale}/admin/requests`,
      }),
    });
    if (result.status !== 'sent') {
      console.error(`Access request notification not sent (${result.status}) for ${shopName}`);
    }
  } else {
    console.error('PLATFORM_ADMIN_EMAILS is not set, so nobody was told about an access request.');
  }

  redirect(`${back}?requested=1`);
}
