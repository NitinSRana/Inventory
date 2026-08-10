import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'supabase/migrations';

/** Migration files in order. `*.test.sql` is the check suite, not a migration. */
export function listMigrations() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.test.sql'))
    .sort()
    .map((name) => {
      const raw = readFileSync(`${DIR}/${name}`, 'utf8');
      return {
        name,
        // psql meta-commands (\echo, \set …) are client directives, not SQL.
        // Everything here runs over a driver rather than through psql.
        sql: raw
          .split('\n')
          .filter((line) => !/^\s*\\/.test(line))
          .join('\n'),
        checksum: createHash('sha256').update(raw).digest('hex').slice(0, 16),
      };
    });
}

/**
 * Applies every migration in order. Used by db:migrate against a real database,
 * and by db:test and the integration harness against throwaway ones — so all
 * three exercise the same path and cannot drift apart.
 *
 * `.simple()` uses the simple query protocol: one file per round trip, and
 * $$-quoted function bodies survive intact.
 */
export async function applyAll(sql, { onApplied } = {}) {
  for (const migration of listMigrations()) {
    await sql.unsafe(migration.sql).simple();
    onApplied?.(migration);
  }
}

export const MIGRATIONS_TABLE_DDL = `
  create schema if not exists app;
  create table if not exists app.schema_migrations (
    name       text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  );
`;
