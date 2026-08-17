import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { mailIsConfigured, sendEmail } from './send.ts';

const saved = { key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM };

afterEach(() => {
  if (saved.key === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = saved.key;
  if (saved.from === undefined) delete process.env.MAIL_FROM;
  else process.env.MAIL_FROM = saved.from;
});

const email = { to: 'staff@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };

test('an unconfigured install reports it rather than throwing', async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;

  assert.equal(mailIsConfigured(), false);
  // No network call is attempted, so this cannot hang or fail a build.
  assert.deepEqual(await sendEmail(email), { status: 'notConfigured' });
});

test('half-configured counts as unconfigured, not as a broken send', async () => {
  // A key with no from address is the likelier half to be missing, and
  // attempting the call would fail with an opaque provider error.
  process.env.RESEND_API_KEY = 'test-key';
  delete process.env.MAIL_FROM;
  assert.equal(mailIsConfigured(), false);
  assert.deepEqual(await sendEmail(email), { status: 'notConfigured' });

  delete process.env.RESEND_API_KEY;
  process.env.MAIL_FROM = 'shop@example.com';
  assert.equal(mailIsConfigured(), false);
  assert.deepEqual(await sendEmail(email), { status: 'notConfigured' });
});

test('fully configured is reported as sendable', () => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.MAIL_FROM = 'shop@example.com';
  assert.equal(mailIsConfigured(), true);
});
