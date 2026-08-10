// Runs *.itest.ts against a real Postgres.
//
// The unit tests cover pure logic. These cover the part that only breaks in
// contact with the database: RLS scoping, the append-only trigger, FEFO across
// batches, transaction boundaries. Until now that was only ever proved by
// throwaway scripts, which is the same as not proving it.
//
// Spins up the same throwaway server db:test uses — no Docker, no credentials.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';

const RUN_ID = `${process.pid}-${Date.now().toString(36)}`;
const PORT = 49152 + ((process.pid + 7) % 15000);
const DATA_DIR = join(tmpdir(), `inv-itest-${RUN_ID}`);
const DB_NAME = 'inv_itest';
const RUNTIME_PASSWORD = 'itest-runtime';

rmSync(DATA_DIR, { recursive: true, force: true });
const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: false,
});

async function teardown(code) {
  await pg.stop().catch(() => {});
  rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(code);
}

await pg.initialise();
await pg.start();

const adminRoot = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;
const root = postgres(adminRoot, { max: 1 });
// UTF8 from template0: on Windows initdb defaults to WIN1252 and the migrations
// contain real UTF-8 characters.
await root.unsafe(
  `create database "${DB_NAME}" encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`,
);
await root.end();

const adminUrl = `postgresql://postgres:postgres@127.0.0.1:${PORT}/${DB_NAME}`;
const admin = postgres(adminUrl, { max: 1 });

const migrations = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.test.sql'))
  .sort();

try {
  for (const file of migrations) {
    const sqlText = readFileSync(`supabase/migrations/${file}`, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*\\/.test(line))
      .join('\n');
    await admin.unsafe(sqlText).simple();
  }
  // 0002 creates app_runtime without a password on purpose — secrets do not
  // belong in committed migrations. The tests need to connect as it, so give it
  // one here, scoped to this throwaway cluster.
  await admin.unsafe(`alter role app_runtime with password '${RUNTIME_PASSWORD}'`);
  console.log(`applied ${migrations.length} migrations`);
} catch (e) {
  console.error('FAIL applying migrations:', e.message);
  await admin.end();
  await teardown(1);
}
await admin.end();

// The app connects as the NON-bypassing role, exactly as production does. Tests
// that pass against a superuser would prove nothing about RLS.
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://app_runtime:${RUNTIME_PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`,
  ADMIN_DATABASE_URL: adminUrl,
};

const files = process.argv.slice(2);
const child = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    '--test',
    // Serial: the tests share one database and assert on its contents.
    '--test-concurrency=1',
    // src/db/tenant.ts opens a connection pool at module load and deliberately
    // never exposes a way to close it. Without this the runner finishes its
    // tests and then hangs forever waiting for that handle to drain.
    '--test-force-exit',
    ...(files.length ? files : ['src/**/*.itest.ts']),
  ],
  { stdio: 'inherit', env, shell: false },
);

child.on('exit', (code) => teardown(code ?? 1));
