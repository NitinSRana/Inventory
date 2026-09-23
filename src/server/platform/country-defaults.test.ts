import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultsForCountry } from './country-defaults.ts';

import { SEEDED_COUNTRIES } from '../settings/vat-seeds.ts';

test('a British shop starts in pounds, on London time', () => {
  // The bug this exists to stop: a GB shop created with euros and Berlin time,
  // pricing every product in the wrong currency from its first day.
  assert.deepEqual(defaultsForCountry('GB'), { currencyCode: 'GBP', timezone: 'Europe/London' });
  assert.deepEqual(defaultsForCountry(' gb '), { currencyCode: 'GBP', timezone: 'Europe/London' });
});

test('the euro countries keep the euro, but not each other’s clocks', () => {
  assert.equal(defaultsForCountry('DE').currencyCode, 'EUR');
  assert.equal(defaultsForCountry('IE').currencyCode, 'EUR');
  assert.equal(defaultsForCountry('IE').timezone, 'Europe/Dublin');
  assert.equal(defaultsForCountry('PT').timezone, 'Europe/Lisbon');
});

test('Poland is neither', () => {
  assert.deepEqual(defaultsForCountry('PL'), { currencyCode: 'PLN', timezone: 'Europe/Warsaw' });
});

test('every country the form offers has an answer', () => {
  // The select is built from SEEDED_COUNTRIES, so a country added there without
  // a currency would silently hand a new shop euros.
  for (const country of SEEDED_COUNTRIES) {
    const { currencyCode, timezone } = defaultsForCountry(country);
    assert.match(currencyCode, /^[A-Z]{3}$/, `${country} has no currency`);
    assert.ok(timezone.includes('/'), `${country} has no timezone`);
    // Proves it is a real IANA name rather than a plausible string: the Store
    // screen and every "today" calculation depend on Postgres knowing it.
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: timezone }), `${country}: ${timezone}`);
  }
});

test('somewhere unlisted falls back rather than failing', () => {
  assert.deepEqual(defaultsForCountry('ZZ'), { currencyCode: 'EUR', timezone: 'Europe/Berlin' });
});
