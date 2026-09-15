import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addToCart, encodeCart, parseCart, removeFromCart, takeOneFromCart } from './cart.ts';

test('the stepper minus takes one unit off, and removes the line at zero', () => {
  const lines = [{ productId: 'a', quantity: '2' }, { productId: 'b', quantity: '1' }];
  assert.deepEqual(takeOneFromCart(lines, 'a'), [{ productId: 'a', quantity: '1' }, { productId: 'b', quantity: '1' }]);
  assert.deepEqual(takeOneFromCart(lines, 'b'), [{ productId: 'a', quantity: '2' }]);
  // Less than one left is not a negative line; the product simply leaves the basket.
  assert.deepEqual(takeOneFromCart([{ productId: 'a', quantity: '0.5' }], 'a'), []);
});

test('parseCart reads id:quantity pairs', () => {
  assert.deepEqual(parseCart('a:2,b:1.500'), [
    { productId: 'a', quantity: '2' },
    { productId: 'b', quantity: '1.500' },
  ]);
});

test('parseCart tolerates the absent, empty and malformed cases', () => {
  assert.deepEqual(parseCart(undefined), []);
  assert.deepEqual(parseCart(''), []);
  assert.deepEqual(parseCart(['array', 'not', 'string']), []);
  // A hand-edited or truncated URL must not crash the page.
  assert.deepEqual(parseCart('garbage'), []);
  assert.deepEqual(parseCart('a:0,b:-1,c:3'), [{ productId: 'c', quantity: '3' }]);
  assert.deepEqual(parseCart('a:not-a-number,b:2'), [{ productId: 'b', quantity: '2' }]);
});

test('encodeCart round-trips through parseCart', () => {
  const lines = [{ productId: 'a', quantity: '2' }, { productId: 'b', quantity: '1.5' }];
  assert.deepEqual(parseCart(encodeCart(lines)), lines);
});

test('adding an unseen product appends a line', () => {
  const lines = addToCart([{ productId: 'a', quantity: '1' }], 'b', '3');
  assert.deepEqual(lines, [
    { productId: 'a', quantity: '1' },
    { productId: 'b', quantity: '3' },
  ]);
});

test('scanning the same product again increments its line, not a duplicate', () => {
  const lines = addToCart([{ productId: 'a', quantity: '1' }], 'a', '2');
  assert.deepEqual(lines, [{ productId: 'a', quantity: '3' }]);
});

test('removeFromCart drops exactly one line', () => {
  const lines = removeFromCart(
    [{ productId: 'a', quantity: '1' }, { productId: 'b', quantity: '2' }],
    'a',
  );
  assert.deepEqual(lines, [{ productId: 'b', quantity: '2' }]);
});
