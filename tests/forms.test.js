import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, rateLimited } from '../forms.mjs';

test('a report needs words, and a valid email if one is given', () => {
  assert.ok(prepare('report', { what: '' }).errors.what);
  assert.ok(prepare('report', { what: 'Closed now', contact: 'not-an-email' }).errors.contact);
  const ok = prepare('report', { what: 'Closed now', place: 'a-cafe' }, 'doc123');
  assert.equal(ok.collection, 'correction-reports');
  assert.equal(ok.data.place, 'doc123');
  assert.equal(ok.data.contact, null);
});

test('a suggestion needs a name, suburbs and contact', () => {
  assert.equal(Object.keys(prepare('suggest', {}).errors).length, 3);
  assert.equal(prepare('suggest', { name: 'X', suburbs: 'Weston', contact: '0400' }).collection, 'listing-submissions');
});

test('a claim must be about a published listing', () => {
  assert.ok(prepare('claim', { person: 'A', email: 'a@b.co', role: 'Owner' }, null).errors.form);
  const ok = prepare('claim', { person: 'A', email: 'a@b.co', role: 'Owner' }, 'doc123');
  assert.equal(ok.collection, 'business-claims');
});

test('long text is cut to size', () => {
  assert.equal(prepare('report', { what: 'x'.repeat(5000) }).data.details.length, 2000);
});

test('unknown forms are refused', () => {
  assert.ok(prepare('admin', {}).errors);
});

test('five submissions per visitor every ten minutes', () => {
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(rateLimited('v1', t + i), false);
  assert.equal(rateLimited('v1', t + 10), true);
  assert.equal(rateLimited('v2', t + 10), false, 'other visitors are not affected');
  assert.equal(rateLimited('v1', t + 11 * 60 * 1000), false, 'allowed again after the window');
});
