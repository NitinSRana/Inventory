import assert from 'node:assert/strict';
import { test } from 'node:test';

import { invitationEmail } from './invitation.ts';

const base = {
  organizationName: 'Demo Grocer',
  signInUrl: 'https://inventory.example.com/en/sign-in',
};

test('names the shop in the subject, so two invitations are tellable apart', () => {
  const { subject } = invitationEmail(base);
  assert.ok(subject.includes('Demo Grocer'), subject);
});

test('carries an absolute link, since a relative one goes nowhere from an inbox', () => {
  const { html, text } = invitationEmail(base);
  assert.ok(html.includes('https://inventory.example.com/en/sign-in'));
  assert.ok(text.includes('https://inventory.example.com/en/sign-in'));
});

test('always sends a text part as well as html', () => {
  const { text, html } = invitationEmail(base);
  assert.ok(text.length > 0);
  assert.ok(!text.includes('<'), 'the text part is text, not stripped markup');
  assert.ok(html.startsWith('<!doctype html>'));
});

test('names the inviter when there is one, and reads fine when there is not', () => {
  const withInviter = invitationEmail({ ...base, invitedByEmail: 'owner@example.com' });
  assert.ok(withInviter.text.includes('by owner@example.com'));

  const without = invitationEmail({ ...base, invitedByEmail: null });
  assert.ok(!without.text.includes('by '), without.text);
  assert.ok(without.text.includes('You have been added to Demo Grocer.'));
});

test('escapes the shop name, which its owner typed', () => {
  const { html } = invitationEmail({
    ...base,
    organizationName: `<script>alert('x')</script> & Sons`,
  });
  assert.ok(!html.includes('<script>'), 'no raw tag survives into the markup');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp; Sons'));
});

test("an apostrophe in a shop name does not break the markup, and is the likely case", () => {
  const { html, subject } = invitationEmail({ ...base, organizationName: "O'Brien's Market" });
  assert.ok(html.includes('O&#39;Brien&#39;s Market'));
  // The subject is not markup, so it keeps the character a person typed.
  assert.ok(subject.includes("O'Brien's Market"));
});

test('escapes the url too, so a crafted redirect cannot break out of the attribute', () => {
  const { html } = invitationEmail({
    ...base,
    signInUrl: 'https://example.com/"><script>alert(1)</script>',
  });
  assert.ok(!html.includes('<script>alert(1)'), 'the attribute is not escapable');
  assert.ok(html.includes('&quot;'));
});
