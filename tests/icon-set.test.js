import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconBody, hasIcon } from '../src/lib/icon-set.js';
import { evidenceBadge } from '../src/lib/format.js';

test('any Lucide icon can be drawn, not only those in icons.json', () => {
  assert.match(iconBody('phone-call'), /<path d="M22 16\.92/);
  assert.match(iconBody('trash-2'), /<path /, 'an icon not in icons.json');
  assert.equal(iconBody('not-an-icon'), null);
  assert.equal(iconBody('constructor'), null, 'object keys are not icons');
  assert.equal(hasIcon(''), false);
});

test('a tile uses its icon when it exists, else the status icon', () => {
  assert.equal(evidenceBadge({ icon: 'trash-2', evidence: 'confirmed' }, hasIcon).icon, 'trash-2');
  assert.equal(evidenceBadge({ icon: 'nope', evidence: 'confirmed' }, hasIcon).icon, 'check');
});
