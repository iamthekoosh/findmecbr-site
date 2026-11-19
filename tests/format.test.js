import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortDate, clock, weekHours, evidenceText, directionsUrl, telUrl } from '../src/lib/format.js';
import { shapePlace, toQuery, byCategory } from '../src/lib/strapi.js';

test('dates read plainly', () => {
  assert.equal(shortDate('2026-11-19'), '19 Nov 2026');
  assert.equal(shortDate(null), '');
});

test('times read plainly', () => {
  assert.equal(clock('07:00'), '7am');
  assert.equal(clock('15:30'), '3:30pm');
  assert.equal(clock('12:00'), 'noon');
});

test('missing days are not confirmed, never closed', () => {
  const rows = weekHours([{ day: 1, opens: '07:00', closes: '15:00' }]);
  assert.equal(rows[0].day, 'Monday');
  assert.equal(rows[0].text, '7am to 3pm');
  assert.equal(rows[1].text, 'Hours not confirmed');
  assert.deepEqual(weekHours([]), []);
});

test('evidence uses the identity wording', () => {
  assert.equal(evidenceText({ label: 'Step-free entry', evidence: 'confirmed' }).text, 'Step-free entry: confirmed');
  assert.equal(evidenceText({ label: 'Step-free entry', evidence: 'business_says' }).text, 'Step-free entry: business says yes');
  assert.equal(evidenceText({ label: 'Step-free entry', evidence: 'unknown' }).text, 'Step-free entry: not confirmed');
});

test('directions and calls', () => {
  assert.match(directionsUrl({ lat: -35.3, lng: 149.05 }), /destination=-35.3,149.05/);
  assert.match(directionsUrl({ address: '', suburb: { name: 'Weston' } }), /Weston%2C%20ACT/);
  assert.equal(telUrl('02 6200 0000'), 'tel:0262000000');
});

test('Strapi query strings use brackets', () => {
  assert.equal(decodeURIComponent(toQuery({ populate: { location: { populate: ['suburb'] } } })), 'populate[location][populate][0]=suburb');
});

const raw = {
  slug: 'home-cleaner', name: 'Home Cleaner', location_type: 'mobile', is_health: false, our_take: 'Reliable',
  primary_category: { slug: 'cleaner', label: 'Cleaner', plural: 'Cleaners' },
  location: { show_public_address: false, public_address: '1 Secret St', lat: -35.3, lng: 149.0, suburb: { slug: 'duffy', name: 'Duffy' }, in_centre: false, centre: null },
  service_areas: [{ suburb: { slug: 'weston', name: 'Weston' } }, { suburb: null }],
  action_tiles: [
    { action: 'book', label: 'Book', provider: 'Own site', url: 'https://x.com', active: true, checked_at: '2026-11-19' },
    { action: 'order', label: 'Order', provider: 'Unchecked', url: 'https://y.com', active: true, checked_at: null },
    { action: 'buy', label: 'Buy', provider: 'Off', url: 'https://z.com', active: false, checked_at: '2026-11-19' },
  ],
};

test('home addresses are hidden when the switch is off', () => {
  const p = shapePlace(raw);
  assert.equal(p.address, '');
  assert.equal(p.lat, null);
  assert.equal(p.suburb.name, 'Duffy');
});

test('only active, checked action tiles show', () => {
  assert.deepEqual(shapePlace(raw).actions.map((a) => a.provider), ['Own site']);
});

test('service areas without a suburb are dropped', () => {
  assert.equal(shapePlace(raw).serviceAreas.length, 1);
});

test('health listings never show an opinion', () => {
  assert.equal(shapePlace({ ...raw, is_health: true }).ourTake, '');
});

test('a centre only counts when the switch is on', () => {
  const on = shapePlace({ ...raw, location: { ...raw.location, in_centre: true, centre: { slug: 'cooleman-court', name: 'Cooleman Court' } } });
  assert.equal(on.centre.name, 'Cooleman Court');
  const off = shapePlace({ ...raw, location: { ...raw.location, in_centre: false, centre: { slug: 'cooleman-court', name: 'Cooleman Court' } } });
  assert.equal(off.centre, null);
});

test('directories group by category', () => {
  const groups = byCategory([shapePlace(raw), shapePlace({ ...raw, slug: 'b', primary_category: { slug: 'cafe', label: 'Cafe', plural: 'Cafes' } })]);
  assert.deepEqual(groups.map((g) => g.category.plural), ['Cafes', 'Cleaners']);
});
