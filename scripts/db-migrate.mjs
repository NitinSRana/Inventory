// Applies pending migrations to the database in ADMIN_DATABASE_URL.
//
// Until now migrations were applied by hand with ad-hoc scripts and nothing
// recorded what had run — re-running 0002 would half-fail, and the only record
// of what production had was memory.
//
// Each file runs inside a transaction and is recorded on success, so a failure
// leaves the database exactly as it was and the run can be repeated.
import postgres from 'postgres';

import { MIGRATIONS_TABLE_DDL, listMigrations } from './lib/migrations.mjs';

try {
  process.loadEnvFile('.env.local');
} catch {
  // Absent in CI.
}

const url = process.env.ADMIN_DATABASE_URL;
if (!url) {
  console.error('ADMIN_DATABASE_URL is not set — migrations need the owner connection.');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
// Records migrations as applied without running them. For adopting a database
// that was migrated by hand before this script existed — which is exactly how
// the Frankfurt project got its first four.
const baseline = process.argv.includes('--baseline');
const sql = postgres(url, { prepare: false, max: 1 });

try {
  await sql.unsafe(MIGRATIONS_TABLE_DDL).simple();

  const applied = new Map(
    (await sql`select name, checksum from app.schema_migrations`).map((r) => [r.name, r.checksum]),
  );

  const all = listMigrations();
  const pending = all.filter((m) => !applied.has(m.name));

  // An applied migration whose contents changed means someone edited history.
  // Refuse rather than guess: the database and the file no longer agree, and
  // nothing here can tell which one is right.
  const edited = all.filter((m) => applied.has(m.name) && applied.get(m.name) !== m.checksum);
  if (edited.length > 0) {
    console.error(
      `Refusing to run. These migrations were edited after being applied:\n  ${edited
        .map((m) => m.name)
        .join('\n  ')}\nWrite a new migration instead.`,
    );
    process.exit(1);
  }

  if (pending.length === 0) {
    console.log(`up to date — ${applied.size} migration(s) applied`);
  } else if (baseline) {
    for (const migration of pending) {
      await sql`insert into app.schema_migrations (name, checksum)
                values (${migration.name}, ${migration.checksum})`;
      console.log(`baselined ${migration.name} (not executed)`);
    }
  } else if (dryRun) {
    console.log(`would apply:\n  ${pending.map((m) => m.name).join('\n  ')}`);
  } else {
    for (const migration of pending) {
      await sql.begin(async (tx) => {
        await tx.unsafe(migration.sql).simple();
        await tx`insert into app.schema_migrations (name, checksum)
                 values (${migration.name}, ${migration.checksum})`;
      });
      console.log(`applied ${migration.name}`);
    }
    console.log(`${pending.length} migration(s) applied`);
  }
} catch (e) {
  console.error(`FAIL ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
