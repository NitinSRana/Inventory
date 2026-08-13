import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeGtin } from './ean.ts';

test('accepts valid EAN-13', () => {
  assert.equal(normalizeGtin('5901234123457'), '5901234123457');
  assert.equal(normalizeGtin('4006381333931'), '4006381333931');
});

test('accepts valid EAN-8', () => {
  assert.equal(normalizeGtin('96385074'), '96385074');
});

test('accepts a valid GTIN-12 (UPC-A)', () => {
  assert.equal(normalizeGtin('036000291452'), '036000291452');
});

test('accepts a valid GTIN-14/ITF-14 (case barcode)', () => {
  assert.equal(normalizeGtin('15901234123454'), '15901234123454');
});

test('strips separators a scanner or a human might add', () => {
  assert.equal(normalizeGtin('  5901234123457 '), '5901234123457');
  assert.equal(normalizeGtin('5901234-123457'), '5901234123457');
});

test('rejects a wrong check digit', () => {
  // Last digit should be 7; every other digit is a valid barcode's.
  assert.equal(normalizeGtin('5901234123458'), null);
  assert.equal(normalizeGtin('96385075'), null);
});

test('rejects wrong lengths and non-digits', () => {
  assert.equal(normalizeGtin('590123412'), null); // 9 digits: not a GTIN length
  assert.equal(normalizeGtin('5901234123456789'), null); // 16 digits
  assert.equal(normalizeGtin(''), null);
  assert.equal(normalizeGtin('590123412345X'), null);
});
