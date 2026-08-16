import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCell } from './display.ts';
import type { Column } from './csv.ts';

// Stand-ins for Intl and trimQuantity, so the rules are what is under test
// rather than the locale data. The quantity stub keeps trimQuantity's own
// `includes('.')` guard: without it "0" trims to "" and a zero on the shelf
// renders as a blank cell.
const fmt = {
  money: (v: number) => `EUR ${v.toFixed(2)}`,
  quantity: (v: string) => (v.includes('.') ? v.replace(/\.?0+$/, '') : v),
};

const money: Column = { key: 'value', label: 'value', numeric: true, format: 'money' };
const qty: Column = { key: 'quantity', label: 'quantity', numeric: true, format: 'quantity' };
const plain: Column = { key: 'name', label: 'product' };

test('money columns are formatted, not shown as raw numerics', () => {
  // The whole point: the row carries 123.4500 so the CSV stays re-importable.
  assert.equal(formatCell(money, '123.4500', fmt), 'EUR 123.45');
});

test('quantity columns lose their trailing zeroes', () => {
  assert.equal(formatCell(qty, '22.000', fmt), '22');
  assert.equal(formatCell(qty, '4.500', fmt), '4.5');
});

test('untagged columns are passed through untouched', () => {
  assert.equal(formatCell(plain, 'Vollmilch 3,5% 1L', fmt), 'Vollmilch 3,5% 1L');
  // A barcode is digits but not a number; formatting it would be wrong.
  assert.equal(formatCell({ key: 'gtin', label: 'barcode' }, '4001234567891', fmt), '4001234567891');
});

test('an absent value reads as nothing, not as a broken cell', () => {
  assert.equal(formatCell(money, '', fmt), '—');
  assert.equal(formatCell(money, undefined, fmt), '—');
});

test('zero is a real figure and survives', () => {
  // '0' is falsy as a string check gone wrong — the reason the guard tests for
  // empty explicitly rather than truthiness.
  assert.equal(formatCell(money, '0', fmt), 'EUR 0.00');
  assert.equal(formatCell(qty, '0', fmt), '0');
});

test('a non-numeric value in a money column is shown, not rendered as NaN', () => {
  assert.equal(formatCell(money, 'n/a', fmt), 'n/a');
});
