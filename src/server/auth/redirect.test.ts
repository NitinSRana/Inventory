import assert from 'node:assert/strict';
import { test } from 'node:test';

import { safeRedirectPath } from './redirect.ts';

const ORIGIN = 'https://inventory.example';
const FALLBACK = '/en';

test('a path on this site is followed, query and all', () => {
  assert.equal(safeRedirectPath('/en/sign-in/reset-password', ORIGIN, FALLBACK), '/en/sign-in/reset-password');
  assert.equal(safeRedirectPath('/de/count?session=abc', ORIGIN, FALLBACK), '/de/count?session=abc');
});

test('another site is never followed, however the link spells it', () => {
  // Each of these resolves to evil.example under `new URL(next, origin)`,
  // which is exactly what the confirm route used to do.
  for (const next of [
    'https://evil.example/login',
    '//evil.example/login',
    '/\\evil.example/login',
    'javascript:alert(1)',
    'evil.example',
  ]) {
    assert.equal(safeRedirectPath(next, ORIGIN, FALLBACK), FALLBACK, next);
  }
});

test('no next at all goes to the fallback', () => {
  assert.equal(safeRedirectPath(null, ORIGIN, FALLBACK), FALLBACK);
  assert.equal(safeRedirectPath('', ORIGIN, FALLBACK), FALLBACK);
});
