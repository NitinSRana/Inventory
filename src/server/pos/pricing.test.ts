import assert from 'node:assert/strict';
import { test } from 'node:test';

import Decimal from 'decimal.js';

import { planLines } from './pricing.ts';

const sum = (values: string[]) => values.reduce((acc, v) => acc.plus(v), new Decimal(0)).toFixed(2);

test('with no markdown, a basket line is the shelf price times the quantity', () => {
  const lines = planLines('1.2900', '0', [{ batchId: 'a', quantity: '3' }]);
  assert.equal(lines.length, 1);
  assert.equal(sum(lines.map((l) => l.lineTotal)), '3.87');
  assert.equal(lines[0].markedDown, false);
});

test('two reduced cartons and one fresh one cost what the two labels say', () => {
  // As a shopper: two cartons with a 0.99 sticker and one at the 1.29 shelf
  // price hand over 3.27 — not three at a blended price nobody printed.
  const lines = planLines('1.2900', '0', [
    { batchId: 'old', quantity: '2', markdownPrice: '0.9900' },
    { batchId: 'new', quantity: '1', markdownPrice: null },
  ]);
  assert.equal(lines.length, 2, 'one line per price');
  assert.equal(sum(lines.map((l) => l.lineTotal)), '3.27');
  assert.deepEqual(
    lines.map((l) => [l.unitPrice, l.quantity, l.markedDown]),
    [
      ['0.99', '2', true],
      ['1.29', '1', false],
    ],
  );
  // The shelf price rides on both, so the recovered money is a stored fact.
  assert.ok(lines.every((l) => l.listPrice === '1.29'));
});

test('net plus VAT reconstructs every line to the penny, markdown or not', () => {
  const lines = planLines('1.1900', '0.19', [
    { batchId: 'old', quantity: '3', markdownPrice: '0.8900' },
    { batchId: 'new', quantity: '1' },
  ]);
  for (const l of lines) {
    assert.equal(new Decimal(l.net).plus(l.vatAmount).toFixed(4), new Decimal(l.lineTotal).toFixed(4));
  }
});

test('a markdown no longer below the shelf price is ignored, never charged', () => {
  // Set at 1.10 when the shelf said 1.49; the shelf has since dropped to 0.99.
  // The "reduced" carton must not cost more than the fresh one beside it.
  const lines = planLines('0.9900', '0', [
    { batchId: 'old', quantity: '1', markdownPrice: '1.1000' },
    { batchId: 'new', quantity: '1' },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].unitPrice, '0.99');
  assert.equal(lines[0].quantity, '2');
});

test('two batches at the same reduced price are one line', () => {
  const lines = planLines('2.4900', '0', [
    { batchId: 'a', quantity: '1', markdownPrice: '1.5000' },
    { batchId: 'b', quantity: '2', markdownPrice: '1.50' },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, '3');
  assert.equal(lines[0].lineTotal, '4.5');
});

test('weighed goods keep their three decimals through the split', () => {
  const lines = planLines('12.0000', '0', [
    { batchId: 'old', quantity: '0.250', markdownPrice: '8.0000' },
    { batchId: 'new', quantity: '0.125' },
  ]);
  assert.equal(sum(lines.map((l) => l.lineTotal)), '3.50');
});
