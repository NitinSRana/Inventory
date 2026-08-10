// Applies every migration plus 0001_init.test.sql to a throwaway database.
//
// By default it starts its own Postgres — a portable server unpacked into
// .pgtest/, no Docker, no admin rights, no password to remember. That matters:
// this suite is the merge gate for schema changes, and a gate nobody can run is
// not a gate.
//
// Set TEST_DATABASE_URL to point at an existing server instead. Never point it
// at Supabase; this creates and drops databases.
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';

import { listMigrations } from './lib/migrations.mjs';

try {
  process.loadEnvFile('.env.local');
} catch {
  // Optional locally, absent in CI.
}

// Unique per run. On Windows the shared-memory key is derived from the data
// directory path, so a fixed path collides with any other postmaster that has
// ever used it — including a system PostgreSQL service.
const RUN_ID = `${process.pid}-${Date.now().toString(36)}`;
const PORT = 49152 + (process.pid % 15000);
const DATA_DIR = join(tmpdir(), `inv-pgtest-${RUN_ID}`);

let pg = null;
let adminUrl = process.env.TEST_DATABASE_URL;

if (!adminUrl) {
  // A fresh cluster every run, so a half-finished previous run cannot leave
  // state that makes the next one pass for the wrong reason.
  rmSync(DATA_DIR, { recursive: true, force: true });
  pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  adminUrl = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;
}

const dbName = `inv_test_${process.pid}`;
const admin = postgres(adminUrl, { max: 1 });
const scratchUrl = new URL(adminUrl);
scratchUrl.pathname = `/${dbName}`;

async function shutdown(code) {
  await admin.end().catch(() => {});
  if (pg) {
    await pg.stop().catch(() => {});
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
  process.exit(code);
}

try {
  // UTF8 from template0, explicitly. On Windows initdb picks WIN1252 from the
  // system locale, and the migrations contain real UTF-8 characters — a "−" in
  // a comment is enough to abort the whole file.
  await admin.unsafe(
    `create database "${dbName}" encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`,
  );
} catch (e) {
  const hint =
    e.code === '28P01'
      ? 'password authentication failed — check TEST_DATABASE_URL in .env.local'
      : e.message;
  console.error(`FAIL cannot reach Postgres at ${scratchUrl.host}: ${hint}`);
  await shutdown(1);
}

// Every migration in order, then the checks. Running all of them — not just
// 0001 — is the point: a later migration that breaks an earlier invariant is
// exactly what this needs to catch.
const migrations = listMigrations();

let failed = false;
// The suite reports itself through RAISE NOTICE; without this handler the run
// is silent and "ok" proves only that nothing threw.
let checks = 0;
const db = postgres(scratchUrl.toString(), {
  max: 1,
  onnotice: (n) => {
    const msg = n.message ?? '';
    if (msg.startsWith('PASS')) checks += 1;
    if (/^(PASS|---)/.test(msg)) console.log('     ' + msg);
  },
});
// The check suite is loaded the same way migrations are, so the psql-stripping
// lives in exactly one place.
const checkSuite = {
  name: '0001_init.test.sql',
  sql: readFileSync('supabase/migrations/0001_init.test.sql', 'utf8')
    .split('\n')
    .filter((line) => !/^\s*\\/.test(line))
    .join('\n'),
};

try {
  for (const file of [...migrations, checkSuite]) {
    await db.unsafe(file.sql).simple();
    console.log(`ok   ${file.name}`);
  }
} catch (e) {
  failed = true;
  console.error(`FAIL ${e.message}${e.position ? ` (at position ${e.position})` : ''}`);
} finally {
  await db.end();
  await admin`drop database ${admin(dbName)}`.catch(() => {});
}

if (!failed) console.log(`
${checks} checks passed`);
await shutdown(failed ? 1 : 0);
