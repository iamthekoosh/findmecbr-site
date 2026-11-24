import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconBody, hasIcon } from '../src/lib/icon-set.js';
import { evidenceBadge } from '../src/lib/format.js';

test('any Lucide icon can be drawn, not only those in icons.json', () => {
  assert.match(iconBody('phone-call'), /<path d="M/);
  assert.match(iconBody('trash-2'), /<path /, 'an icon not in icons.json');
  assert.match(iconBody('circle-letter-p'), /<path |<circle /, 'an icon new in Lucide 1.x');
  assert.equal(iconBody('not-an-icon'), null);
  assert.equal(iconBody('constructor'), null, 'object keys are not icons');
  assert.equal(iconBody('../package'), null, 'names are never paths');
  assert.equal(hasIcon(''), false);
});

test('old Lucide names and the brand logos still draw', () => {
  for (const name of ['smile', 'square-parking', 'circle-parking', 'music-2', 'circle-help']) assert.ok(hasIcon(name), name);
  for (const name of ['facebook', 'instagram', 'linkedin', 'youtube']) assert.match(iconBody(name), /<path |<rect /, name);
});

test('a tile uses its icon when it exists, else the status icon', () => {
  assert.equal(evidenceBadge({ icon: 'trash-2', evidence: 'confirmed' }, hasIcon).icon, 'trash-2');
  assert.equal(evidenceBadge({ icon: 'nope', evidence: 'confirmed' }, hasIcon).icon, 'check');
});
