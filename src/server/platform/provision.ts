import { accessApprovedEmail } from '@/server/email/access-request';
import { sendEmail } from '@/server/email/send';

import { createLogin, passwordSetupLink, type LoginResult } from './auth-admin';
import { createShop } from './create-shop';

/**
 * Everything that happens once someone is allowed in: the shop, the login, and
 * the email that lets them choose a password.
 *
 * Shared by the two ways onto the platform — approving a request someone made,
 * and the owner creating a shop outright — because they differ only in what
 * decides them. A shop set up by hand must come out identical to an approved
 * one, or the two paths drift and only one of them gets fixed.
 *
 * Nothing here rolls back. The invitation row is what grants access, so a
 * failed login or a failed email leaves a usable shop and a problem the screen
 * reports, rather than an approval silently undone.
 */
export type Provisioned = {
  orgId: string;
  email: string;
  shopName: string;
  /** Whether the applicant now has a login they can use. */
  login: LoginResult;
  mail: 'sent' | 'failed' | 'notConfigured';
  /** What VAT seeding concluded; `unknownCountry` means rates must be set by hand. */
  vat: 'ok' | 'unknownCountry' | 'alreadyConfigured';
};

export type Site = { origin: string; locale: string };

export async function provisionShop(input: {
  /** Supply one to make a retry rebuild the same shop rather than a second. */
  orgId: string;
  shopName: string;
  countryCode: string;
  ownerEmail: string;
  adminUserId: string;
  site: Site;
}): Promise<Provisioned> {
  const { orgId, shopName, countryCode, ownerEmail, adminUserId, site } = input;

  const shop = await createShop({
    id: orgId,
    name: shopName,
    countryCode,
    ownerEmail,
    invitedBy: adminUserId,
  });

  const login = await createLogin(ownerEmail);

  // Minted after the login exists, because a recovery link needs an account to
  // recover. If it cannot be minted the email still goes, pointing at the magic
  // link tab — worse, but not a lost approval.
  const setPasswordUrl =
    (await passwordSetupLink(ownerEmail, site.origin, site.locale)) ??
    `${site.origin}/${site.locale}/sign-in?mode=link`;

  const mail = await sendEmail({
    to: ownerEmail,
    ...accessApprovedEmail({ shopName, setPasswordUrl }),
  });

  return { orgId: shop.orgId, email: ownerEmail, shopName, login, mail: mail.status, vat: shop.vat };
}
