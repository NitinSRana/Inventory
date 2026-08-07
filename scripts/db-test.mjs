// Applies 0001_init.sql + 0001_init.test.sql to a throwaway database.
// Node rather than the bash one-liner in SETUP.md: pnpm runs scripts through
// cmd.exe on Windows, where `$$` is not a PID and `;` does not chain.
// Needs a Postgres server, not psql — TEST_DATABASE_URL points at its
// maintenance database. Never point it at Supabase; this creates and drops.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // Optional locally, absent in CI.
}

const adminUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const dbName = `inv_test_${process.pid}`;

const admin = postgres(adminUrl, { max: 1 });
const scratchUrl = new URL(adminUrl);
scratchUrl.pathname = `/${dbName}`;

let failed = false;
await admin`create database ${admin(dbName)}`;
const db = postgres(scratchUrl.toString(), { max: 1 });
try {
  for (const file of ['0001_init.sql', '0001_init.test.sql']) {
    // .simple() uses the simple query protocol, so one file = one round trip and
    // $$-quoted function bodies survive intact.
    await db.unsafe(readFileSync(`supabase/migrations/${file}`, 'utf8')).simple();
    console.log(`ok   ${file}`);
  }
} catch (e) {
  failed = true;
  console.error(`FAIL ${e.message}${e.position ? ` (at position ${e.position})` : ''}`);
} finally {
  await db.end();
  await admin`drop database ${admin(dbName)}`;
  await admin.end();
}

process.exit(failed ? 1 : 0);
