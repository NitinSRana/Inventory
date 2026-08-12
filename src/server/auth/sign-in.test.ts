import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isUnknownAddress, signInOutcome } from './sign-in.ts';

test('a member and a stranger are told exactly the same thing', () => {
  const member = signInOutcome(null);
  const stranger = signInOutcome({ code: 'otp_disabled', message: 'Signups not allowed for otp' });

  assert.equal(member, 'sent=1');
  assert.equal(
    stranger,
    member,
    'the form must not reveal whether an address belongs to this shop',
  );
});

test('a failure everyone would hit is still surfaced', () => {
  assert.equal(signInOutcome({ code: 'over_email_send_rate_limit' }), 'error=1');
  assert.equal(signInOutcome({ code: 'validation_failed' }), 'error=1');
});

test('a refusal that would identify a member is hidden', () => {
  // What Supabase actually returns for a stranger while sign-up is closed.
  assert.equal(
    isUnknownAddress({ code: 'otp_disabled', message: 'Signups not allowed for otp' }),
    true,
  );
  assert.equal(isUnknownAddress({ code: 'user_not_found' }), true);
  assert.equal(isUnknownAddress({ code: 'signup_disabled' }), true);
});

test('older releases are matched on the message, which carries no code', () => {
  assert.equal(isUnknownAddress({ message: 'Signups not allowed for this instance' }), true);
});

test('a failure that happens to everyone is still reported', () => {
  // These reveal nothing about who is a member, and hiding them would leave a
  // typo looking like success.
  assert.equal(isUnknownAddress({ code: 'validation_failed', message: 'Unable to validate email' }), false);
  assert.equal(isUnknownAddress({ code: 'over_email_send_rate_limit' }), false);
  assert.equal(isUnknownAddress({ code: 'unexpected_failure' }), false);
  assert.equal(isUnknownAddress({ message: 'fetch failed' }), false);
});

test('success is not a refusal', () => {
  assert.equal(isUnknownAddress(null), false);
});
