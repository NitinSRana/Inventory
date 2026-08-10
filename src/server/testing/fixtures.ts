import postgres from 'postgres';

/**
 * Fixtures for *.itest.ts. Only ever imported by integration tests, so it never
 * reaches the application bundle.
 *
 * Uses the admin connection deliberately: creating the first organization is the
 * one write that cannot be tenant-scoped, because the tenant does not exist yet.
 */

const admin = postgres(process.env.ADMIN_DATABASE_URL!, { prepare: false, max: 1 });

export type TestOrg = { orgId: string; locationId: string; userId: string };

/**
 * A fresh organization per test file, so tests cannot see each other's rows —
 * and so a leak between them would show up as a failure rather than as noise.
 */
export async function createTestOrg(name: string): Promise<TestOrg> {
  const [org] = await admin`
    insert into organizations (name, country_code) values (${name}, 'DE') returning id`;
  const [location] = await admin`
    insert into locations (organization_id, name, is_default)
    values (${org.id}, 'Store', true) returning id`;
  const userId = crypto.randomUUID();
  await admin`
    insert into organization_members (organization_id, user_id, role)
    values (${org.id}, ${userId}, 'owner')`;
  return { orgId: org.id, locationId: location.id, userId };
}

/** Raw admin access, for asserting on state the app layer deliberately hides. */
export const adminSql = admin;

export async function closeFixtures() {
  await admin.end();
}
