import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COUNTRY_VAT_SEEDS, SEEDED_COUNTRIES } from './vat-seeds.ts';
import { grossValue, netFromGross } from './valuation.ts';

test('every seeded country has a standard rate', () => {
  for (const country of SEEDED_COUNTRIES) {
    assert.ok(COUNTRY_VAT_SEEDS[country].standard, `${country} has no standard rate`);
  }
});

test('seed rates are fractions in numeric(5,4) range, not percentages', () => {
  // 19 instead of 0.19 would fail the CHECK (rate between 0 and 1) at insert.
  for (const [country, bands] of Object.entries(COUNTRY_VAT_SEEDS)) {
    for (const [band, rate] of Object.entries(bands)) {
      const n = Number(rate);
      assert.ok(n >= 0 && n <= 1, `${country}.${band} = ${rate} is out of range`);
      assert.match(rate!, /^\d\.\d{4}$/, `${country}.${band} = ${rate} is not numeric(5,4)`);
    }
  }
});

test('gross adds VAT to a net amount', () => {
  assert.equal(grossValue('100', '0.1900'), '119.00');
  assert.equal(grossValue('0.79', '0.0700'), '0.85');
});

test('a zero rate leaves the amount alone', () => {
  assert.equal(grossValue('42.50', '0.0000'), '42.50');
});

test('net recovers the original from gross', () => {
  // The round trip has to hold or stock valuation drifts by a few cents a line.
  assert.equal(netFromGross(grossValue('100', '0.1900'), '0.1900'), '100.00');
  assert.equal(netFromGross('119.00', '0.1900'), '100.00');
});

test('valuation does not use float arithmetic', () => {
  // 0.1 + 0.2 style drift would show up here as 1.1000000000000001.
  assert.equal(grossValue('0.1', '0.0000'), '0.10');
  assert.equal(grossValue('1.005', '0.0000'), '1.01');
});
