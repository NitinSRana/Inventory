import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * Every name a server action reads out of a FormData must exist as a real
 * control on the page that posts it.
 *
 * A mismatch is silent: `formData.get('quantity')` against a field named `qty`
 * returns null, the action writes a nonsense value or throws, and neither tsc
 * nor eslint can see it — a server action's input is stringly typed by
 * construction. The E2E flows catch this on the five daily paths; this catches
 * it everywhere, including VAT rates, team invitations and the CSV import,
 * which nobody clicks through often enough to notice a silent break.
 */

/** node:fs globSync exists at runtime but not in @types/node 20; walk instead. */
function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

/**
 * Only things that actually post a value count.
 *
 * `<Field name="quantity">` looks like a control and is not one — it labels the
 * control inside it. Counting the wrapper made an earlier version of this test
 * pass while the real input was renamed, which is precisely the bug it exists to
 * find.
 */
const CONTROL = /<(?:Input|NativeSelect|input|select|textarea)\b[^>]*>/g;
const NAME = /\bname=(?:"([^"]+)"|\{`([^`]+)`\})/;

function declaredNames(src: string) {
  const names = new Set<string>();
  for (const [tag] of src.matchAll(CONTROL)) {
    const m = tag.match(NAME);
    if (m) names.add(m[1] ?? m[2]);
  }
  // BarcodeField names its own control; the page never declares it.
  if (src.includes('<BarcodeField')) names.add('gtin');
  return names;
}

/**
 * Which keys this file pulls out of the posted form.
 *
 * Half the actions read `formData.get('x')` directly; the rest go through a
 * local `value('x')` helper that trims and nulls empty strings. Missing the
 * second kind let a renamed expiry field slip past an earlier version of this
 * test, so the helper is detected by its own body rather than by name alone.
 */
function readKeys(src: string) {
  const keys = [...src.matchAll(/formData\.get(?:All)?\(\s*'([^']+)'/g)].map((m) => m[1]);
  if (/formData\.get\(\s*key\s*\)/.test(src)) {
    keys.push(...[...src.matchAll(/\bvalue\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]));
  }
  // Per-row fields: formData.get(`lot:${lineId}`). Only the literal prefix is
  // knowable statically, and that is the half that drifts.
  keys.push(...[...src.matchAll(/formData\.get\(\s*`([^$`]+)\$\{/g)].map((m) => m[1]));
  return new Set(keys);
}

test('every posted field has a matching control', () => {
  const files = componentFiles('src');
  // A walk that silently found nothing would make this test pass forever.
  assert.ok(files.length > 20, `only found ${files.length} components`);

  const problems: string[] = [];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const read = readKeys(src);
    if (read.size === 0) continue;

    const declared = declaredNames(src);
    // Prefixes of names built per row, like `qty:${line.id}`.
    const prefixes = [...declared]
      .filter((d) => d.includes('${'))
      .map((d) => d.split('${')[0])
      .filter((p) => p.length > 0);

    for (const key of read) {
      const dynamic = prefixes.some((p) => key.startsWith(p) || p.startsWith(key));
      if (!declared.has(key) && !dynamic) {
        problems.push(`${file}: action reads "${key}", no control declares it`);
      }
    }
  }

  assert.deepEqual(problems, []);
});
