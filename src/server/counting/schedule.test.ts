import assert from 'node:assert/strict';
import { test } from 'node:test';

import { daysOverdue, intervalDays } from './schedule.ts';

const now = new Date('2026-08-10T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 864e5);

test('maps each frequency to its interval', () => {
  assert.equal(intervalDays('weekly'), 7);
  assert.equal(intervalDays('biweekly'), 14);
  assert.equal(intervalDays('monthly'), 30);
  assert.equal(intervalDays('quarterly'), 90);
});

test('an unset or unrecognised frequency falls back to monthly', () => {
  assert.equal(intervalDays(null), 30);
  assert.equal(intervalDays(undefined), 30);
  assert.equal(intervalDays('fortnightly'), 30);
});

test('a product counted within its interval is not due', () => {
  assert.ok(daysOverdue(daysAgo(3), 'weekly', now) < 0);
  assert.ok(daysOverdue(daysAgo(20), 'monthly', now) < 0);
});

test('due exactly on the interval boundary', () => {
  assert.equal(daysOverdue(daysAgo(7), 'weekly', now), 0);
});

test('overdue counts the days past the interval', () => {
  assert.equal(daysOverdue(daysAgo(10), 'weekly', now), 3);
  assert.equal(daysOverdue(daysAgo(45), 'monthly', now), 15);
});

test('a never-counted product is due now, not infinitely overdue', () => {
  // Otherwise a freshly imported catalogue buries genuinely drifting stock
  // under thousands of products that have simply never been touched.
  assert.equal(daysOverdue(null, 'weekly', now), 0);
});

test('frequency changes what counts as overdue for the same last count', () => {
  const lastCount = daysAgo(30);
  assert.equal(daysOverdue(lastCount, 'weekly', now), 23);
  assert.equal(daysOverdue(lastCount, 'monthly', now), 0);
  assert.ok(daysOverdue(lastCount, 'quarterly', now) < 0);
});
