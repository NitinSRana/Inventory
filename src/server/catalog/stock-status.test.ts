import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stockStatus } from './stock-status.ts';

test('nothing on hand is out, whatever the minimum', () => {
  assert.equal(stockStatus('0', null), 'out');
  assert.equal(stockStatus('0.000', '5'), 'out');
  // A count can leave the ledger negative; that is still out, not "low".
  assert.equal(stockStatus('-2', '5'), 'out');
});

test('below the minimum is low; at the minimum is not', () => {
  assert.equal(stockStatus('4', '5'), 'low');
  assert.equal(stockStatus('5', '5'), 'in');
  // Weighed goods keep their decimals.
  assert.equal(stockStatus('0.450', '0.5'), 'low');
});

test('no minimum set can never be low', () => {
  assert.equal(stockStatus('1', null), 'in');
});
