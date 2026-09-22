import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPlatformAdmin } from './allowlist.ts';

/**
 * The allowlist is the only thing standing between a shopkeeper and every other
 * shop's numbers, so its matching rules are worth pinning exactly.
 */

const LIST = 'nitin@logicbevers.com, colleague@logicbevers.com';

test('an address on the list matches, whatever the case or spacing', () => {
  assert.equal(isPlatformAdmin('nitin@logicbevers.com', LIST), true);
  assert.equal(isPlatformAdmin('  Nitin@LogicBevers.com  ', LIST), true);
  assert.equal(isPlatformAdmin('colleague@logicbevers.com', LIST), true);
});

test('an address that merely contains one does not', () => {
  // Substring matching here would hand the platform to anyone who can register
  // a lookalike domain, or prefix their own local part.
  assert.equal(isPlatformAdmin('evil-nitin@logicbevers.com', LIST), false);
  assert.equal(isPlatformAdmin('nitin@logicbevers.com.attacker.example', LIST), false);
  assert.equal(isPlatformAdmin('nitin@logicbevers.co', LIST), false);
});

test('no allowlist means no admin, rather than an open door', () => {
  // A deployment that forgot the variable must have no admin area at all.
  assert.equal(isPlatformAdmin('nitin@logicbevers.com', undefined), false);
  assert.equal(isPlatformAdmin('nitin@logicbevers.com', ''), false);
  assert.equal(isPlatformAdmin('nitin@logicbevers.com', '   ,  ,'), false);
});

test('no address means no admin', () => {
  assert.equal(isPlatformAdmin(null, LIST), false);
  assert.equal(isPlatformAdmin('', LIST), false);
  assert.equal(isPlatformAdmin('   ', LIST), false);
});
