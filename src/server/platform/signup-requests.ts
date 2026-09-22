import { sql } from 'drizzle-orm';

import { appQuery } from '@/db/tenant';
import { accessDeclinedEmail } from '@/server/email/access-request';
import { invitationEmail } from '@/server/email/invitation';
import { sendEmail, type SendResult } from '@/server/email/send';

import { createLogin, type LoginResult } from './auth-admin';
import { createShop } from './create-shop';

/**
 * Access requests: the queue between a stranger filling in the landing-page form
 * and a shop existing.
 *
 * Every route to the table is a security definer function in the `app` schema
 * (migration 0018) — app_runtime has no grant on the table itself. The functions
 * are callable by any request path, because Postgres cannot know who the
 * platform owner is, so every entry point here is expected to have passed
 * requirePlatformAdmin first. submitRequest is the deliberate exception: it is
 * public, which is the point of it.
 */

export type SignupStatus = 'pending' | 'approved' | 'declined';

export type SignupRequest = {
  id: string;
  email: string;
  contactName: string;
  shopName: string;
  countryCode: string;
  status: SignupStatus;
  organizationId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

type Row = {
  id: string;
  email: string;
  contact_name: string;
  shop_name: string;
  country_code: string;
  status: SignupStatus;
  organization_id: string | null;
  decided_at: Date | null;
  created_at: Date;
};

const asRequest = (r: Row): SignupRequest => ({
  id: r.id,
  email: r.email,
  contactName: r.contact_name,
  shopName: r.shop_name,
  // char(2) comes back padded if it was ever written short.
  countryCode: r.country_code.trim(),
  status: r.status,
  organizationId: r.organization_id,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
});

/**
 * Records a request from the public form.
 *
 * Returns nothing, and that is the guarantee: a second submission from the same
 * address is silently the same row, so the page cannot say anything that would
 * tell a stranger whether that address had applied — or been approved — before.
 */
export async function submitRequest(input: {
  email: string;
  contactName: string;
  shopName: string;
  countryCode: string;
}): Promise<void> {
  await appQuery(
    sql`select app.request_signup(${input.email}, ${input.contactName}, ${input.shopName}, ${input.countryCode})`,
  );
}

export async function listRequests(status?: SignupStatus): Promise<SignupRequest[]> {
  const rows = await appQuery<Row>(sql`select * from app.list_signup_requests(${status ?? null})`);
  return rows.map(asRequest);
}

export type ApproveResult =
  | { outcome: 'notPending' }
  | {
      outcome: 'approved';
      orgId: string;
      email: string;
      shopName: string;
      /** Whether the applicant now has a login they can use. */
      login: LoginResult;
      mail: SendResult['status'];
      vat: 'ok' | 'unknownCountry' | 'alreadyConfigured';
    };

/**
 * Approves a request and builds the shop behind it.
 *
 * The state transition happens first, on purpose. A crash anywhere after it
 * leaves an approved request pointing at an organization id, and every later
 * step is idempotent, so clicking Approve again rebuilds against that same id.
 * The other order — create the shop, then mark the request — is the one that
 * leaves orphan shops nobody can reach.
 *
 * Neither a failed login nor a failed email rolls anything back: the invitation
 * row is what grants access, exactly as it is for an ordinary team invitation.
 * Both outcomes come back so the screen can say what actually happened.
 */
export async function approveRequest(
  id: string,
  adminUserId: string,
  signInUrl: string,
): Promise<ApproveResult> {
  const [request] = (await listRequests()).filter((r) => r.id === id);
  if (!request || request.status === 'declined') return { outcome: 'notPending' };

  const proposedId = crypto.randomUUID();
  const rows = await appQuery<{ org: string | null }>(
    sql`select app.claim_signup_request(${id}::uuid, ${proposedId}::uuid, ${adminUserId}::uuid) as org`,
  );
  const orgId = rows[0]?.org;
  // Declined or vanished between the read and the claim.
  if (!orgId) return { outcome: 'notPending' };

  const shop = await createShop({
    id: orgId,
    name: request.shopName,
    countryCode: request.countryCode,
    ownerEmail: request.email,
    invitedBy: adminUserId,
  });

  const login = await createLogin(request.email);
  const mail = await sendEmail({
    to: request.email,
    ...invitationEmail({ organizationName: request.shopName, signInUrl }),
  });

  return {
    outcome: 'approved',
    orgId: shop.orgId,
    email: request.email,
    shopName: request.shopName,
    login,
    mail: mail.status,
    vat: shop.vat,
  };
}

/** Declines a request and tells the applicant, briefly. */
export async function declineRequest(
  id: string,
  adminUserId: string,
): Promise<{ declined: boolean; mail: SendResult['status'] | null }> {
  const [request] = (await listRequests()).filter((r) => r.id === id);
  const rows = await appQuery<{ declined: boolean }>(
    sql`select app.decline_signup_request(${id}::uuid, ${adminUserId}::uuid) as declined`,
  );
  const declined = rows[0]?.declined === true;
  if (!declined || !request) return { declined, mail: null };

  const mail = await sendEmail({
    to: request.email,
    ...accessDeclinedEmail({ shopName: request.shopName }),
  });
  return { declined, mail: mail.status };
}
