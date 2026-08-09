import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InsufficientStockError, allocateFefo, type BatchStock } from './fefo.ts';

const batches: BatchStock[] = [
  { batchId: 'later', expiryDate: '2026-09-01', quantity: '10.000' },
  { batchId: 'soonest', expiryDate: '2026-08-15', quantity: '4.000' },
  { batchId: 'middle', expiryDate: '2026-08-20', quantity: '6.000' },
];

test('takes from the earliest expiry first', () => {
  assert.deepEqual(allocateFefo(batches, '3'), [{ batchId: 'soonest', quantity: '3' }]);
});

test('spans batches in expiry order when one is not enough', () => {
  assert.deepEqual(allocateFefo(batches, '12'), [
    { batchId: 'soonest', quantity: '4' },
    { batchId: 'middle', quantity: '6' },
    { batchId: 'later', quantity: '2' },
  ]);
});

test('batches with no expiry are used last', () => {
  const withNull: BatchStock[] = [
    { batchId: 'noExpiry', expiryDate: null, quantity: '5.000' },
    { batchId: 'dated', expiryDate: '2026-12-01', quantity: '2.000' },
  ];
  assert.deepEqual(allocateFefo(withNull, '4'), [
    { batchId: 'dated', quantity: '2' },
    { batchId: 'noExpiry', quantity: '2' },
  ]);
});

test('handles fractional quantities without float drift', () => {
  const weighed: BatchStock[] = [
    { batchId: 'a', expiryDate: '2026-08-15', quantity: '0.100' },
    { batchId: 'b', expiryDate: '2026-08-16', quantity: '0.200' },
  ];
  // 0.1 + 0.2 === 0.30000000000000004 in float arithmetic.
  assert.deepEqual(allocateFefo(weighed, '0.3'), [
    { batchId: 'a', quantity: '0.1' },
    { batchId: 'b', quantity: '0.2' },
  ]);
});

test('skips empty and negative batches', () => {
  const withEmpty: BatchStock[] = [
    { batchId: 'empty', expiryDate: '2026-08-01', quantity: '0.000' },
    { batchId: 'real', expiryDate: '2026-08-15', quantity: '5.000' },
  ];
  assert.deepEqual(allocateFefo(withEmpty, '2'), [{ batchId: 'real', quantity: '2' }]);
});

test('refuses to over-allocate', () => {
  assert.throws(() => allocateFefo(batches, '21'), InsufficientStockError);
  // Exactly the available amount is fine.
  assert.equal(allocateFefo(batches, '20').length, 3);
});

test('rejects a non-positive quantity', () => {
  assert.throws(() => allocateFefo(batches, '0'));
  assert.throws(() => allocateFefo(batches, '-1'));
});
