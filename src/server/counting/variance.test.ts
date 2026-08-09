import assert from 'node:assert/strict';
import { test } from 'node:test';

import { varianceOf, varianceSummary, type CountLine } from './variance.ts';

test('lines that agree produce no adjustment', () => {
  const lines: CountLine[] = [
    { productId: 'a', batchId: null, expectedQuantity: '5.000', countedQuantity: '5.000' },
  ];
  assert.deepEqual(varianceOf(lines), []);
});

test('short and over both produce a signed delta', () => {
  const lines: CountLine[] = [
    { productId: 'short', batchId: null, expectedQuantity: '10.000', countedQuantity: '7.000' },
    { productId: 'over', batchId: null, expectedQuantity: '2.000', countedQuantity: '3.500' },
  ];
  assert.deepEqual(varianceOf(lines), [
    { productId: 'short', batchId: null, expected: '10', counted: '7', delta: '-3' },
    { productId: 'over', batchId: null, expected: '2', counted: '3.5', delta: '1.5' },
  ]);
});

test('a product the ledger has never seen counts as expected zero', () => {
  const lines: CountLine[] = [
    { productId: 'new', batchId: null, expectedQuantity: null, countedQuantity: '4.000' },
  ];
  assert.deepEqual(varianceOf(lines), [
    { productId: 'new', batchId: null, expected: '0', counted: '4', delta: '4' },
  ]);
});

test('counting zero on a product the ledger thinks is stocked is a real variance', () => {
  const lines: CountLine[] = [
    { productId: 'gone', batchId: null, expectedQuantity: '6.000', countedQuantity: '0' },
  ];
  assert.equal(varianceOf(lines)[0].delta, '-6');
});

test('fractional counts do not drift', () => {
  const lines: CountLine[] = [
    { productId: 'weighed', batchId: null, expectedQuantity: '0.300', countedQuantity: '0.100' },
  ];
  // 0.3 - 0.1 === 0.19999999999999998 in float arithmetic.
  assert.equal(varianceOf(lines)[0].delta, '-0.2');
});

test('summary separates shrink from gain and values both', () => {
  const variances = varianceOf([
    { productId: 'a', batchId: null, expectedQuantity: '10', countedQuantity: '7' },
    { productId: 'b', batchId: null, expectedQuantity: '2', countedQuantity: '4' },
  ]);
  const summary = varianceSummary(variances, { a: '2.0000', b: '1.5000' });

  assert.deepEqual(summary, {
    linesWithVariance: 2,
    linesShort: 1,
    linesOver: 1,
    shrinkValue: '6',
    gainValue: '3',
    netValue: '-3',
  });
});

test('a product with no cost still counts as a line, worth nothing', () => {
  const variances = varianceOf([
    { productId: 'nocost', batchId: null, expectedQuantity: '5', countedQuantity: '1' },
  ]);
  const summary = varianceSummary(variances, { nocost: null });
  assert.equal(summary.linesShort, 1);
  assert.equal(summary.shrinkValue, '0');
});
