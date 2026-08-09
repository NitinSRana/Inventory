import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  aggregateRate,
  consumptionForPeriod,
  suggestedOrderQuantity,
  type Period,
} from './rate.ts';

test('consumption is opening + receipts - waste - closing', () => {
  // Started with 20, took in 30, binned 2, ended with 18 => sold 30 over 10 days.
  const r = consumptionForPeriod({ opening: '20', receipts: '30', waste: '2', closing: '18', days: 10 });
  assert.equal(r.consumed, '30');
  assert.equal(r.dailyRate, '3');
});

test('no receipts and no waste is just the difference', () => {
  const r = consumptionForPeriod({ opening: '14', receipts: '0', waste: '0', closing: '7', days: 7 });
  assert.equal(r.consumed, '7');
  assert.equal(r.dailyRate, '1');
});

test('a zero-length window yields no rate rather than a division by zero', () => {
  const r = consumptionForPeriod({ opening: '10', receipts: '0', waste: '0', closing: '5', days: 0 });
  assert.equal(r.dailyRate, null);
});

test('negative consumption is floored, and still reported as consumed', () => {
  // More on the shelf than the ledger can explain: an unrecorded delivery.
  const r = consumptionForPeriod({ opening: '5', receipts: '0', waste: '0', closing: '9', days: 7 });
  assert.equal(r.consumed, '-4');
  assert.equal(r.dailyRate, '0', 'a negative rate would tell the shop to order nothing');
});

test('fractional quantities do not drift', () => {
  const r = consumptionForPeriod({ opening: '0.3', receipts: '0', waste: '0.1', closing: '0', days: 1 });
  assert.equal(r.consumed, '0.2');
});

test('one window is low confidence, several is higher', () => {
  const w: Period = { opening: '10', receipts: '0', waste: '0', closing: '3', days: 7 };
  assert.equal(aggregateRate([w]).confidence, 'low');
  assert.equal(aggregateRate([w, w]).confidence, 'medium');
  assert.equal(aggregateRate([w, w, w, w]).confidence, 'high');
});

test('no usable window means insufficient and a null rate, never a confident zero', () => {
  const r = aggregateRate([]);
  assert.equal(r.confidence, 'insufficient');
  assert.equal(r.dailyRate, null);
  const zeroDays = aggregateRate([{ opening: '5', receipts: '0', waste: '0', closing: '1', days: 0 }]);
  assert.equal(zeroDays.confidence, 'insufficient');
  assert.equal(zeroDays.dailyRate, null);
});

test('aggregate weights by total days, not by window count', () => {
  const r = aggregateRate([
    { opening: '10', receipts: '0', waste: '0', closing: '0', days: 10 },
    { opening: '2', receipts: '0', waste: '0', closing: '0', days: 2 },
  ]);
  assert.equal(r.consumed, '12');
  assert.equal(r.dailyRate, '1');
});

test('order quantity covers lead time plus safety, less stock and open orders', () => {
  // 2/day, 5 day lead + 3 safety = 16 needed, 4 on hand, 2 already ordered.
  const q = suggestedOrderQuantity({ dailyRate: '2', leadTimeDays: 5, onHand: '4', onOrder: '2' });
  assert.equal(q, '10');
});

test('nothing is suggested when cover is already sufficient', () => {
  assert.equal(suggestedOrderQuantity({ dailyRate: '1', leadTimeDays: 2, onHand: '50', onOrder: '0' }), null);
});

test('open purchase orders prevent double-ordering', () => {
  const withoutPo = suggestedOrderQuantity({ dailyRate: '2', leadTimeDays: 5, onHand: '0', onOrder: '0' });
  const withPo = suggestedOrderQuantity({ dailyRate: '2', leadTimeDays: 5, onHand: '0', onOrder: '16' });
  assert.equal(withoutPo, '16');
  assert.equal(withPo, null);
});

test('min stock acts as a floor when the rate is tiny', () => {
  const q = suggestedOrderQuantity({ dailyRate: '0.1', leadTimeDays: 2, onHand: '0', onOrder: '0', minStock: '6' });
  assert.equal(q, '6');
});

test('an unknown rate suggests nothing at all', () => {
  assert.equal(suggestedOrderQuantity({ dailyRate: null, leadTimeDays: 5, onHand: '0', onOrder: '0' }), null);
});
