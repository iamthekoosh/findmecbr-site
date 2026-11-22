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

test('a place shows in the district section that matches its class', async () => {
  const { shapePlace, districtSections } = await import('../src/lib/strapi.js');
  const school = shapePlace({ slug: 'a', name: 'A', place_class: 'essential_service', primary_category: { slug: 'school', label: 'School', plural: 'Schools', kind: 'venue' }, location: { suburb: { slug: 'holder', name: 'Holder' } } });
  const cafe = shapePlace({ slug: 'b', name: 'B', primary_category: { slug: 'cafe', label: 'Cafe', plural: 'Cafes', kind: 'venue' }, location: { suburb: { slug: 'holder', name: 'Holder' } } });
  assert.equal(cafe.placeClass, 'business');
  const site = {
    suburbs: [{ slug: 'holder', district: { slug: 'wc' } }],
    categories: [{ slug: 'school', plural: 'Schools', kind: 'venue', active: true }, { slug: 'cafe', plural: 'Cafes', kind: 'venue', active: true }],
    places: [school, cafe],
  };
  const [essential, services, businesses] = districtSections(site, { slug: 'wc' });
  assert.deepEqual(essential.list.map((c) => c.slug), ['school']);
  assert.equal(essential.key, 'essential-services');
  assert.equal(services.list.length, 0);
  assert.deepEqual(businesses.list.map((c) => c.slug), ['cafe']);
});

test('post status defaults to unverified and keeps known values', () => {
  assert.equal(shapePlace({ slug: 'a', name: 'A' }).postStatus, 'unverified');
  assert.equal(shapePlace({ slug: 'a', name: 'A', post_status: 'info_online' }).postStatus, 'info_online');
  assert.equal(shapePlace({ slug: 'a', name: 'A', post_status: 'nonsense' }).postStatus, 'unverified');
});

test('tile sets: match by category, keep tile order, mark missing ones unconfirmed', async () => {
  const { shapeTileSet, tileSetsFor } = await import('../src/lib/format.js');
  const extras = shapeTileSet({
    name: 'Extras', heading: 'Extra services', position: 10, show_missing: true, active: true,
    categories: [{ slug: 'grocery' }, { slug: 'service-station' }],
    tags: [{ slug: 'ice', label: 'Ice', icon: 'snowflake' }, { slug: 'liquor', label: 'Liquor', icon: 'wine' }, { slug: 'lotto', label: 'Lotto', icon: 'ticket' }],
  });
  const known = shapeTileSet({ name: 'Known', heading: 'At the counter', position: 5, show_missing: false, active: true, categories: [{ slug: 'grocery' }], tags: [{ slug: 'lotto', label: 'Lotto' }, { slug: 'liquor', label: 'Liquor' }] });
  const off = shapeTileSet({ name: 'Off', heading: 'Draft set', active: false, categories: [{ slug: 'grocery' }], tags: [{ slug: 'ice', label: 'Ice' }] });
  const grocery = { category: { slug: 'grocery' }, facts: [{ slug: 'liquor', label: 'Liquor', evidence: 'business_says', icon: null }] };

  const sets = tileSetsFor(grocery, [extras, known, off]);
  assert.deepEqual(sets.map((s) => s.heading), ['At the counter', 'Extra services'], 'lower position first; inactive sets left out');
  assert.deepEqual(sets[0].tiles.map((t) => t.slug), ['liquor'], 'show missing off: only tiles with a fact');
  assert.deepEqual(sets[1].tiles.map((t) => [t.label, t.evidence]), [['Ice', 'unknown'], ['Liquor', 'business_says'], ['Lotto', 'unknown']]);
  assert.equal(sets[1].tiles[1].icon, 'wine', "a fact without its own icon uses the tag's");

  assert.equal(tileSetsFor({ category: { slug: 'cafe' }, facts: [] }, [extras]).length, 0);
  assert.equal(tileSetsFor({ category: { slug: 'cafe' }, otherCategories: [{ slug: 'service-station' }], facts: [] }, [extras]).length, 1);
  assert.equal(tileSetsFor({ category: { slug: 'grocery' }, facts: [] }, [known]).length, 0, 'a set with nothing to show is dropped');
});

test('tile sets picked on a place replace the ones for its type, and hidden tiles are left out', async () => {
  const { shapeTileSet, tileSetsFor } = await import('../src/lib/format.js');
  const extras = shapeTileSet({ name: 'Extras', heading: 'Extra services', active: true, categories: [{ slug: 'grocery' }], tags: [{ slug: 'ice', label: 'Ice' }, { slug: 'lpg-swap', label: 'LPG swap' }, { slug: 'lotto', label: 'Lotto' }] });
  const deli = shapeTileSet({ name: 'Deli', heading: 'At the deli', active: true, categories: [], tags: [{ slug: 'sliced-meats', label: 'Sliced meats' }] });
  const off = shapeTileSet({ name: 'Off', heading: 'Draft', active: false, categories: [], tags: [{ slug: 'ice', label: 'Ice' }] });
  const base = { category: { slug: 'grocery' }, facts: [] };

  assert.deepEqual(tileSetsFor(base, [extras, deli]).map((s) => s.heading), ['Extra services'], 'by type when nothing is picked');
  assert.deepEqual(tileSetsFor({ ...base, tileSetChoice: ['Deli'] }, [extras, deli]).map((s) => s.heading), ['At the deli'], 'picked sets replace the type ones');
  assert.deepEqual(tileSetsFor({ ...base, tileSetChoice: ['Deli', 'Extras'] }, [extras, deli]).length, 2);
  assert.equal(tileSetsFor({ ...base, tileSetChoice: ['Off'] }, [off]).length, 0, 'a set that is off never shows');
  assert.deepEqual(tileSetsFor({ ...base, hiddenTiles: ['lpg-swap'] }, [extras])[0].tiles.map((x) => x.slug), ['ice', 'lotto']);
});
