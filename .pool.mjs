process.loadEnvFile('.env.local');
const { default: postgres } = await import('postgres');
const ref = 'ayrwmcpmzcvsysfuvgli';
const pw = new URL(process.env.ADMIN_DATABASE_URL).password; // already encoded
for (const host of ['aws-0-eu-central-1', 'aws-1-eu-central-1']) {
  const url = `postgresql://postgres.${ref}:${pw}@${host}.pooler.supabase.com:5432/postgres`;
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
  try {
    const [r] = await sql`select current_user u`;
    console.log(host, '-> OK as', r.u);
    console.log('POOLERHOST' + host);
    break;
  } catch (e) { console.log(host, '->', e.code || e.message); }
  finally { await sql.end({ timeout: 5 }); }
}
