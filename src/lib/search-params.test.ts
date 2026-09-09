import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LIST_LIMITS, dateParam, limitFrom, one, pick } from './search-params.ts';

test('one returns a single value and ignores blanks', () => {
  assert.equal(one('cash'), 'cash');
  assert.equal(one('  cash  '), 'cash');
  assert.equal(one(undefined), undefined);
  assert.equal(one(''), undefined);
  assert.equal(one('   '), undefined);
});

test('a repeated param takes the first, rather than throwing or joining', () => {
  // ?tender=cash&tender=card is a URL anyone can type; it must not become
  // the string "cash,card" and reach a where clause.
  assert.equal(one(['cash', 'card']), 'cash');
  assert.equal(one([]), undefined);
});

test('pick only returns a value the caller allows', () => {
  const tenders = ['cash', 'card'] as const;
  assert.equal(pick('cash', tenders), 'cash');
  assert.equal(pick('card', tenders), 'card');
  assert.equal(pick('cheque', tenders), undefined);
  assert.equal(pick(undefined, tenders), undefined);
});

test('pick refuses anything an address bar could smuggle in', () => {
  const statuses = ['completed', 'voided'] as const;
  assert.equal(pick("' or 1=1 --", statuses), undefined);
  assert.equal(pick('COMPLETED', statuses), undefined, 'case must match exactly');
});

test('dateParam accepts a real ISO date and refuses anything else', () => {
  assert.equal(dateParam('2026-03-01'), '2026-03-01');
  assert.equal(dateParam(undefined), undefined);
  // A junk value would otherwise reach a ::date cast and 500 the page.
  assert.equal(dateParam('banana'), undefined);
  assert.equal(dateParam("2026-01-01'; drop table sales; --"), undefined);
  assert.equal(dateParam('01/03/2026'), undefined, 'ambiguous formats are refused, not guessed');
});

test('dateParam refuses a date that does not exist', () => {
  // Date() would roll this into 2 March rather than reject it.
  assert.equal(dateParam('2026-02-30'), undefined);
  assert.equal(dateParam('2026-13-01'), undefined);
});

test('limitFrom accepts only the offered limits, and defaults to the smallest', () => {
  assert.equal(limitFrom('200'), 200);
  assert.equal(limitFrom('1000'), 1000);
  assert.equal(limitFrom(undefined), LIST_LIMITS[0]);
  // A hand-typed limit must not become an unbounded scan of the table.
  assert.equal(limitFrom('999999'), LIST_LIMITS[0]);
  assert.equal(limitFrom('abc'), LIST_LIMITS[0]);
  assert.equal(limitFrom('-1'), LIST_LIMITS[0]);
});
