import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, parseQuery, isOpenNow } from '../src/lib/search.js';

const site = {
  suburbs: [{ slug: 'weston', name: 'Weston', lat: -35.336, lng: 149.059 }, { slug: 'rivett', name: 'Rivett', lat: -35.346, lng: 149.038 }],
  categories: [
    { slug: 'cafe', label: 'Cafe', plural: 'Cafes', kind: 'venue' },
    { slug: 'electrician', label: 'Electrician', plural: 'Electricians', kind: 'service' },
  ],
  tags: [{ slug: 'with-kids', label: 'With kids', group: 'occasion', question: 'who' }, { slug: 'step-free-entry', label: 'Step-free entry', group: 'feature' }, { slug: 'liquor', label: 'Liquor', group: 'feature' }],
  synonyms: [{ term: 'sparky', category: 'electrician' }, { term: 'cooleman court', suburb: 'weston' }, { term: 'beer', tag: 'liquor' }],
  places: [
    { slug: 'a-cafe', name: 'A Cafe', cat: 'cafe', type: 'physical', sub: 'weston', lat: -35.336, lng: 149.059, areas: [], short: 'Coffee', phone: '1', website: '', hours: [[1, '07:00', '15:00']],
      facts: { 'step-free-entry': 1 }, occ: ['with-kids'] },
    { slug: 'b-cafe', name: 'B Cafe', cat: 'cafe', type: 'physical', sub: 'rivett', lat: -35.346, lng: 149.038, areas: [], short: 'Toasties', phone: '', website: '', hours: [],
      facts: { liquor: 1 }, occ: [] },
    { slug: 'spark', name: 'Spark Co', cat: 'electrician', type: 'mobile', sub: 'duffy', lat: null, lng: null, areas: ['rivett'], short: '', phone: '1', website: '', hours: [], facts: {}, occ: [] },
  ],
};

test('synonyms and suburb names are understood', () => {
  const q = parseQuery('sparky servicing Rivett', site);
  assert.equal(q.cat, 'electrician');
  assert.equal(q.suburb, 'rivett');
});

test('a service only shows for suburbs it confirmed', () => {
  assert.deepEqual(search({ q: 'sparky in Rivett' }, site).results.map((p) => p.slug), ['spark']);
  assert.deepEqual(search({ q: 'sparky in Weston' }, site).results, []);
});

test('step-free needs the step-free tile', () => {
  assert.deepEqual(search({ cat: 'cafe', step: '1' }, site).results.map((p) => p.slug), ['a-cafe']);
});

test('unknown hours never count as open', () => {
  assert.equal(isOpenNow(site.places[1]), null);
  const monday9am = new Date('2026-11-23T09:00:00+11:00');
  assert.equal(isOpenNow(site.places[0], monday9am), true);
  assert.deepEqual(search({ cat: 'cafe', open: '1' }, site, { now: monday9am }).results.map((p) => p.slug), ['a-cafe']);
});

test('ideas combine, and every one must match', () => {
  assert.deepEqual(search({ occ: 'with-kids' }, site).results.map((p) => p.slug), ['a-cafe']);
  assert.deepEqual(search({ occ: 'with-kids,rainy-day' }, site).results, []);
});

test('a suburb limits venues to that suburb', () => {
  assert.deepEqual(search({ q: 'cafes in Rivett' }, site).results.map((p) => p.slug), ['b-cafe']);
});

test('plain words search names and descriptions', () => {
  assert.deepEqual(search({ q: 'toasties' }, site).results.map((p) => p.slug), ['b-cafe']);
});

test('a synonym for a tile finds places that have it', () => {
  assert.equal(parseQuery('beer', site).has, 'liquor');
  assert.deepEqual(search({ q: 'beer' }, site).results.map((r) => r.slug), ['b-cafe']);
});

test('a tile title finds places that have that tile', () => {
  assert.equal(parseQuery('liquor', site).has, 'liquor');
  assert.deepEqual(search({ q: 'Liquor' }, site).results.map((r) => r.slug), ['b-cafe']);
  assert.equal(parseQuery('step-free entry', site).step, true);
  assert.deepEqual(search({ q: 'step-free entry' }, site).results.map((r) => r.slug), ['a-cafe']);
  assert.deepEqual(search({ q: 'liquor rivett' }, site).results.map((r) => r.slug), ['b-cafe']);
});

test('a tile search leaves out child places that only get the tile from their parent', () => {
  const child = { ...site.places[1], slug: 'b-kiosk', name: 'B Kiosk', facts: { liquor: 1 }, parentFacts: ['liquor'] };
  const own = { ...site.places[1], slug: 'b-bar', name: 'B Bar', facts: { liquor: 1 } };
  const s = { ...site, places: [...site.places, child, own] };
  assert.deepEqual(search({ q: 'liquor' }, s).results.map((r) => r.slug).sort(), ['b-bar', 'b-cafe']);
  assert.deepEqual(search({ q: 'beer' }, s).results.map((r) => r.slug).sort(), ['b-bar', 'b-cafe']);
});

test('near me puts the closest places first and leaves out far ones', () => {
  // Standing in Rivett: B Cafe is next door, A Cafe is about 2.2 km away.
  const origin = { lat: -35.346, lng: 149.038, suburb: 'rivett' };
  const r = search({ cat: 'cafe', near: '1' }, site, { origin });
  assert.equal(r.cond.radius, 5);
  assert.deepEqual(r.results.map((p) => p.slug), ['b-cafe', 'a-cafe']);
  assert.deepEqual(search({ cat: 'cafe', near: '1', radius: '2' }, site, { origin }).results.map((p) => p.slug), ['b-cafe']);
  const far = { lat: -35.2, lng: 149.1, suburb: 'rivett' };
  assert.deepEqual(search({ cat: 'cafe', near: '1' }, site, { origin: far }).results, []);
  assert.deepEqual(search({ cat: 'cafe', near: '1', radius: 'any' }, site, { origin: far }).results.map((p) => p.slug), ['a-cafe', 'b-cafe']);
});

test('near me lists services that come to you after places with a distance', () => {
  const origin = { lat: -35.346, lng: 149.038, suburb: 'rivett' };
  assert.deepEqual(search({ near: '1' }, site, { origin }).results.map((p) => p.slug), ['b-cafe', 'a-cafe', 'spark']);
});
