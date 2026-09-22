import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accessDeclinedEmail, accessRequestEmail } from './access-request.ts';

/**
 * Every field in the notification was typed by a stranger into a public form.
 * This is the one email in the product where that is true.
 */

const REQUEST = {
  contactName: 'Anna Müller',
  email: 'anna@example.com',
  shopName: "Anna's Bio-Feinkost",
  countryCode: 'DE',
  reviewUrl: 'https://app.example.com/en/admin/requests',
};

test('the subject names the shop, and both parts are present', () => {
  const email = accessRequestEmail(REQUEST);
  assert.match(email.subject, /Anna's Bio-Feinkost/);
  assert.ok(email.text.includes('anna@example.com'));
  assert.ok(email.html.includes(REQUEST.reviewUrl));
});

test('a script tag typed into the form does not reach the inbox as markup', () => {
  const email = accessRequestEmail({
    ...REQUEST,
    shopName: '<script>alert(1)</script>',
    contactName: '"><img src=x onerror=alert(1)>',
  });
  // The point is that nothing opens a tag: the payload survives as visible
  // text, which is why `onerror=` itself is still in there, inert.
  assert.equal(email.html.includes('<script>'), false);
  assert.equal(email.html.includes('<img'), false);
  assert.ok(email.html.includes('&lt;script&gt;'));
  assert.ok(email.html.includes('&lt;img'));
});

test('an apostrophe in a shop name survives as text, not as a broken attribute', () => {
  const email = accessRequestEmail(REQUEST);
  assert.ok(email.html.includes('Anna&#39;s Bio-Feinkost'));
});

test('the decline says which shop and offers a reply, without a reason', () => {
  const email = accessDeclinedEmail({ shopName: "Anna's Bio-Feinkost" });
  assert.match(email.subject, /Anna's Bio-Feinkost/);
  assert.ok(email.text.includes('reply'));
  assert.ok(email.html.includes('Anna&#39;s Bio-Feinkost'));
});
