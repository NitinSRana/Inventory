import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { organizationInvitations, organizationMembers } from '@/db/schema';
import { withTenant } from '@/db/tenant';

import type { Role } from './roles';

/**
 * Team management.
 *
 * Nothing here creates a Supabase auth user — that needs the service_role key,
 * which is banned from request-handling code. An owner records an invitation
 * against an email; the person signs in with a magic link like anyone else and
 * their invitation is claimed on first sign-in.
 */

export class LastOwnerError extends Error {
  constructor() {
    super('An organization must keep at least one owner');
    this.name = 'LastOwnerError';
  }
}

export async function listMembers(orgId: string) {
  return withTenant(orgId, (tx) =>
    tx
      .select({
        id: organizationMembers.id,
        userId: organizationMembers.userId,
        role: organizationMembers.role,
        joinedAt: organizationMembers.createdAt,
      })
      .from(organizationMembers)
      .orderBy(asc(organizationMembers.createdAt)),
  );
}

export async function listPendingInvitations(orgId: string) {
  return withTenant(orgId, (tx) =>
    tx
      .select()
      .from(organizationInvitations)
      .where(isNull(organizationInvitations.acceptedAt))
      .orderBy(asc(organizationInvitations.createdAt)),
  );
}

export async function inviteMember(
  orgId: string,
  input: { email: string; role: Role; invitedBy?: string | null },
) {
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('A valid email address is required');

  return withTenant(orgId, async (tx) => {
    // Re-inviting the same address updates the role rather than colliding with
    // the pending-email unique index — an owner correcting a mistake should not
    // have to revoke first. Done in two statements because the index is on an
    // expression, lower(email), which onConflictDoUpdate cannot target.
    const [existing] = await tx
      .select({ id: organizationInvitations.id })
      .from(organizationInvitations)
      .where(
        and(
          sql`lower(${organizationInvitations.email}) = ${email}`,
          isNull(organizationInvitations.acceptedAt),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await tx
        .update(organizationInvitations)
        .set({ role: input.role })
        .where(eq(organizationInvitations.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await tx
      .insert(organizationInvitations)
      .values({
        organizationId: orgId,
        email,
        role: input.role,
        invitedBy: input.invitedBy ?? null,
      })
      .returning();
    return created;
  });
}

export async function revokeInvitation(orgId: string, invitationId: string) {
  return withTenant(orgId, (tx) =>
    tx
      .delete(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.id, invitationId),
          isNull(organizationInvitations.acceptedAt),
        ),
      ),
  );
}

/** Owners left standing after this change. Used to refuse the last one leaving. */
async function ownerCountExcluding(orgId: string, excludeMemberId: string) {
  const [row] = await withTenant(orgId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.role, 'owner'), sql`${organizationMembers.id} <> ${excludeMemberId}`),
      ),
  );
  return row?.n ?? 0;
}

/**
 * Demoting or removing the last owner would lock the organization out of its
 * own settings with no way back in — nobody left who can promote anyone. The
 * database cannot express "at least one row with role owner", so it is checked
 * here and tested.
 */
export async function changeMemberRole(orgId: string, memberId: string, role: Role) {
  if (role !== 'owner' && (await ownerCountExcluding(orgId, memberId)) === 0) {
    throw new LastOwnerError();
  }
  const [member] = await withTenant(orgId, (tx) =>
    tx
      .update(organizationMembers)
      .set({ role })
      .where(eq(organizationMembers.id, memberId))
      .returning(),
  );
  return member ?? null;
}

export async function removeMember(orgId: string, memberId: string) {
  if ((await ownerCountExcluding(orgId, memberId)) === 0) throw new LastOwnerError();
  return withTenant(orgId, (tx) =>
    tx.delete(organizationMembers).where(eq(organizationMembers.id, memberId)),
  );
}
