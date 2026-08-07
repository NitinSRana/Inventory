// Creates an organization and attaches an existing user to it as owner.
//
// Onboarding is manual for the first design partners (CLAUDE.md), so this is a
// script rather than a signup flow. The user must have signed in at least once
// so that Supabase has an auth.users row for them.
//
//   node scripts/create-org.mjs "Store name" owner@example.com [DE]
//
// Runs as ADMIN_DATABASE_URL: creating the first org is the one write that
// cannot be tenant-scoped, because the tenant does not exist yet.
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // Expected in CI.
}

const [name, email, country = 'DE'] = process.argv.slice(2);
if (!name || !email) {
  console.error('usage: node scripts/create-org.mjs "Store name" owner@example.com [COUNTRY]');
  process.exit(1);
}

const sql = postgres(process.env.ADMIN_DATABASE_URL, { prepare: false, max: 1 });
try {
  const [user] = await sql`select id from auth.users where email = ${email} limit 1`;
  if (!user) {
    console.error(`No Supabase user for ${email}. Sign in once at /en/sign-in first.`);
    process.exit(1);
  }

  const [existing] = await sql`
    select organization_id from organization_members where user_id = ${user.id} limit 1`;
  if (existing) {
    console.error(`${email} already belongs to org ${existing.organization_id}.`);
    process.exit(1);
  }

  const orgId = await sql.begin(async (tx) => {
    const [org] = await tx`
      insert into organizations (name, country_code) values (${name}, ${country}) returning id`;
    await tx`
      insert into locations (organization_id, name, is_default)
      values (${org.id}, 'Store', true)`;
    await tx`
      insert into organization_members (organization_id, user_id, role)
      values (${org.id}, ${user.id}, 'owner')`;
    return org.id;
  });

  console.log(`created org ${orgId} (${name}), ${email} is owner`);
} finally {
  await sql.end();
}
