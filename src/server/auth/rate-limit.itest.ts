import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  SIGN_IN_PER_EMAIL,
  checkRateLimit,
  hashedBucket,
  type Limit,
} from '@/server/auth/rate-limit';
import { adminSql } from '@/server/testing/fixtures';

const short: Limit = { limit: 3, windowSeconds: 300 };

describe('rate limiting', () => {
  test('allows up to the limit, then refuses', async () => {
    const bucket = `test:${crypto.randomUUID()}`;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await checkRateLimit(bucket, short));
    assert.deepEqual(results, [true, true, true, false, false]);
  });

  test('buckets are independent, so one address cannot lock out another', async () => {
    const a = `test:${crypto.randomUUID()}`;
    const b = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 4; i++) await checkRateLimit(a, short);
    assert.equal(await checkRateLimit(a, short), false);
    assert.equal(await checkRateLimit(b, short), true, 'b must be unaffected by a being throttled');
  });

  test('attempts outside the window do not count', async () => {
    const bucket = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) await checkRateLimit(bucket, short);
    assert.equal(await checkRateLimit(bucket, short), false);

    // Age the recorded attempts past the window.
    await adminSql`update app.rate_limits set occurred_at = now() - interval '10 minutes'
                   where bucket = ${bucket}`;
    assert.equal(await checkRateLimit(bucket, short), true);
  });

  test('the stored bucket holds no email address', async () => {
    const email = 'someone@example.com';
    const bucket = await hashedBucket('signin-email', email);
    await checkRateLimit(bucket, SIGN_IN_PER_EMAIL);

    const rows = await adminSql`select bucket from app.rate_limits where bucket = ${bucket}`;
    assert.equal(rows.length >= 1, true);
    // This table sits outside the tenant model; it has no business holding
    // every address anyone ever tried.
    assert.equal(bucket.includes(email), false);
    assert.equal(bucket.includes('example.com'), false);
    assert.match(bucket, /^signin-email:[0-9a-f]{32}$/);
  });

  test('the same address hashes to the same bucket regardless of case', async () => {
    assert.equal(
      await hashedBucket('signin-email', 'Someone@Example.com'),
      await hashedBucket('signin-email', 'someone@example.com'),
    );
  });
});
