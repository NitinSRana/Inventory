import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Every name a server action reads out of a FormData must exist as a control on
 * the page that posts it.
 *
 * A mismatch is silent: `formData.get('quantity')` on a field named `qty`
 * returns null, the action writes a nonsense value or throws, and nothing in the
 * type system notices — a server action's input is stringly typed by
 * construction. The E2E flows catch it for the five daily ones; this catches it
 * for every form in the app, including the ones nobody clicks through often
 * enough to notice, like VAT rates and team invitations.
 */
test('every posted field has a matching control', () => {
  const problems: string[] = [];

  for (const file of globSync('src/**/*.tsx')) {
    const src = readFileSync(file, 'utf8');

    const read = new Set([...src.matchAll(/formData\.get(?:All)?\(\s*'([^']+)'/g)].map((m) => m[1]));
    if (read.size === 0) continue;

    const declared = new Set(
      [...src.matchAll(/\bname=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map((m) => m[1] ?? m[2]),
    );
    // BarcodeField names its own control; the page never declares it.
    if (src.includes('<BarcodeField')) declared.add('gtin');

    for (const key of read) {
      // Names built per row, like `qty:${line.id}`, are matched on their prefix.
      const dynamic = [...declared].some(
        (d) => d.includes('${') && key.startsWith(d.split('${')[0]),
      );
      if (!declared.has(key) && !dynamic) {
        problems.push(`${file}: action reads "${key}", no control declares it`);
      }
    }
  }

  assert.deepEqual(problems, []);
});
