import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseGs1 } from './gs1.ts';

const GS = '\x1D';
// Valid GTIN-14 (from ean.test.ts's own fixture — same checksum-verified value).
const GTIN14 = '15901234123454';

test('reads fixed-length AIs back to back: GTIN then expiry', () => {
  const label = parseGs1(`01${GTIN14}17261231`);
  assert.equal(label?.gtin, GTIN14);
  assert.equal(label?.expiryDate, '2026-12-31');
  assert.equal(label?.lotNumber, null);
  assert.equal(label?.quantity, null);
  assert.deepEqual(label?.extra, []);
});

test('reads a variable-length AI terminated by GS, then the next AI', () => {
  const label = parseGs1(`01${GTIN14}10LOT42${GS}3712`);
  assert.equal(label?.gtin, GTIN14);
  assert.equal(label?.lotNumber, 'LOT42');
  assert.equal(label?.quantity, '12');
});

test('a variable-length AI as the last element is terminated by end of string', () => {
  const label = parseGs1(`01${GTIN14}10LOT-9`);
  assert.equal(label?.lotNumber, 'LOT-9');
});

test('day 00 in an expiry date means the last day of the month', () => {
  const label = parseGs1(`01${GTIN14}17040400`); // YYMMDD 04-04-00 -> April 2004
  assert.equal(label?.expiryDate, '2004-04-30');
});

test('a calendar-invalid expiry date is dropped, not silently rolled forward', () => {
  const label = parseGs1(`01${GTIN14}17020229`); // YYMMDD 02-02-29: 2002 is not a leap year
  assert.equal(label?.expiryDate, null);
});

test('net weight applies the decimal-point AI digit', () => {
  const label = parseGs1(`01${GTIN14}3102012345`);
  assert.equal(label?.netWeightKg, '123.45');
});

test('a bad GTIN checksum invalidates the whole label, not just that AI', () => {
  const corrupted = `${GTIN14.slice(0, -1)}0`; // last digit changed, checksum now wrong
  assert.equal(parseGs1(`01${corrupted}17261231`), null);
});

test('a string with no recognisable AI structure is not GS1 at all', () => {
  // A plain, valid EAN-13 — the caller's existing barcode path handles this.
  assert.equal(parseGs1('5901234123457'), null);
});

test('empty or blank input is not GS1', () => {
  assert.equal(parseGs1(''), null);
  assert.equal(parseGs1('   '), null);
});

test('a non-numeric AI 37 value is rejected rather than surfacing as the string "NaN"', () => {
  // No GS separator between (37) and the next AI: without one, the parser
  // cannot tell where (37)'s value ends, so it must reject rather than treat
  // the unparseable remainder as a quantity.
  const label = parseGs1(`01${GTIN14}371291INTERNAL`);
  assert.notEqual(label?.quantity, 'NaN');
  assert.equal(label?.quantity, null);
});

test('AI 91-99 (company internal) is surfaced raw, never interpreted', () => {
  const label = parseGs1(`01${GTIN14}91ABC123`);
  assert.deepEqual(label?.extra, [{ ai: '91', value: 'ABC123' }]);
});

test('an AI outside the known set keeps the remainder raw rather than desyncing', () => {
  const label = parseGs1(`01${GTIN14}21SERIAL123`);
  assert.equal(label?.gtin, GTIN14);
  assert.deepEqual(label?.extra, [{ ai: 'unrecognised', value: '21SERIAL123' }]);
});
