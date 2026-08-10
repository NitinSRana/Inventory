import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isRole, roleAtLeast } from './roles.ts';

test('owner satisfies every requirement', () => {
  assert.ok(roleAtLeast('owner', 'staff'));
  assert.ok(roleAtLeast('owner', 'manager'));
  assert.ok(roleAtLeast('owner', 'owner'));
});

test('manager satisfies staff and manager, not owner', () => {
  assert.ok(roleAtLeast('manager', 'staff'));
  assert.ok(roleAtLeast('manager', 'manager'));
  assert.equal(roleAtLeast('manager', 'owner'), false);
});

test('staff satisfies only staff', () => {
  assert.ok(roleAtLeast('staff', 'staff'));
  assert.equal(roleAtLeast('staff', 'manager'), false);
  assert.equal(roleAtLeast('staff', 'owner'), false);
});

test('an unknown or missing role is denied, never treated as staff', () => {
  // A membership row carrying a role this build does not know is a bug. Falling
  // back to the lowest role would silently grant access.
  assert.equal(roleAtLeast('admin', 'staff'), false);
  assert.equal(roleAtLeast(null, 'staff'), false);
  assert.equal(roleAtLeast(undefined, 'staff'), false);
  assert.equal(roleAtLeast('', 'staff'), false);
});

test('isRole narrows only the three known roles', () => {
  assert.ok(isRole('staff'));
  assert.ok(isRole('manager'));
  assert.ok(isRole('owner'));
  assert.equal(isRole('superuser'), false);
  assert.equal(isRole(null), false);
});
