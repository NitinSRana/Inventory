import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatRate, trimQuantity } from './quantity.ts';

test('trimQuantity drops dead zeros without touching real digits', () => {
  assert.equal(trimQuantity('22.000'), '22');
  assert.equal(trimQuantity('5.429'), '5.429');
  assert.equal(trimQuantity('5.420'), '5.42');
  assert.equal(trimQuantity('0.000'), '0');
  assert.equal(trimQuantity('-3.000'), '-3');
  // No decimal point to trim: a plain integer must survive intact, or "1000"
  // becomes "1".
  assert.equal(trimQuantity('1000'), '1000');
  assert.equal(trimQuantity('0.500'), '0.5');
});

test('formatRate states an estimate to one decimal', () => {
  assert.equal(formatRate('3.4286'), '3.4');
  assert.equal(formatRate('3.0000'), '3');
  assert.equal(formatRate('0.0400'), '0');
  assert.equal(formatRate('12.9500'), '13');
});
