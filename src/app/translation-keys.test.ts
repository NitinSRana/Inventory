import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * Every key a screen asks for must exist in the message catalogue.
 *
 * next-intl throws on a missing key, so this is not a cosmetic fault — it is a
 * blank screen, and only on the one route that asks for it. Typecheck cannot
 * see it: `t('willImport')` is a string, and the catalogue is JSON. The E2E
 * flows walk five daily paths; the reports, the imports and the team screen are
 * exactly the ones nobody opens often enough to find a missing key by accident.
 *
 * Deliberately narrow: only keys written as plain literals are checked. A
 * template key like `t(\`problems.\${message}\`)` is resolved at runtime from a
 * value this file cannot know, so it is skipped rather than guessed at — the
 * enum-shaped ones are covered by the integration tests that produce them.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const messages = JSON.parse(readFileSync('messages/en.json', 'utf8')) as Record<string, unknown>;

function has(path: string): boolean {
  let node: unknown = messages;
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[segment];
  }
  return node !== undefined;
}

/** `getTranslations('sales')` and `useTranslations('sales')`, plus the variable it lands in. */
const NAMESPACE = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:get|use)Translations\(\s*'([^']+)'/g;

test('every literal translation key a screen asks for exists', () => {
  const missing: string[] = [];

  for (const file of [...sourceFiles('src/app'), ...sourceFiles('src/components')]) {
    const src = readFileSync(file, 'utf8');

    const namespaces = new Map<string, string>();
    for (const [, variable, namespace] of src.matchAll(NAMESPACE)) {
      namespaces.set(variable, namespace);
    }
    if (namespaces.size === 0) continue;

    for (const [variable, namespace] of namespaces) {
      // `t('a.b')` and `t.rich('a.b')`, but never `t(`a.${b}`)`.
      const calls = new RegExp(`\\b${variable}(?:\\.rich)?\\(\\s*'([^']+)'`, 'g');
      for (const [, key] of src.matchAll(calls)) {
        const full = `${namespace}.${key}`;
        if (!has(full)) missing.push(`${file}: ${full}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});

test('no message is an empty string, which renders as a blank label', () => {
  const empty: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') {
      if (node.trim() === '') empty.push(path);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(messages, '');
  assert.deepEqual(empty, []);
});

/**
 * The report labels, which the check above cannot see.
 *
 * `reports/[slug]/page.tsx` renders every column as `t(\`columns.${c.label}\`)`
 * and every report as `t(\`names.${slug}\`)`, so the keys are assembled at
 * runtime from data. But that data is a literal in `src/server/reports/index.ts`
 * — `label: 'net'`, `REPORT_SLUGS` — so it can be read from the source and
 * checked properly rather than skipped. Deleting `reports.columns.net` slips
 * past the general test; it must not slip past this one.
 */
test('every report column and slug has a label in the catalogue', () => {
  const src = readFileSync('src/server/reports/index.ts', 'utf8');
  const missing: string[] = [];

  const labels = new Set([...src.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]));
  assert.ok(labels.size > 10, 'the labels were found at all, not silently zero');
  for (const label of labels) {
    if (!has(`reports.columns.${label}`)) missing.push(`reports.columns.${label}`);
  }

  const slugBlock = src.match(/REPORT_SLUGS = \[([^\]]+)\]/)?.[1] ?? '';
  const slugs = [...slugBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(slugs.length > 0, 'the slugs were found at all');
  for (const slug of slugs) {
    // Four keys per report, and a report is unreachable-looking without any of
    // them: the list row, its blurb, and the headline on the report itself.
    for (const group of ['names', 'blurbs', 'headline', 'headlineCaption']) {
      if (!has(`reports.${group}.${slug}`)) missing.push(`reports.${group}.${slug}`);
    }
  }

  assert.deepEqual(missing, []);
});
