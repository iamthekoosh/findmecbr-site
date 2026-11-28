import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortDate, clock, weekHours, directionsUrl, telUrl } from '../src/lib/format.js';
import { shapePlace, shapeInformation, toQuery, byCategory } from '../src/lib/strapi.js';

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

test('labelled sessions read time then label, one per line', () => {
  const rows = weekHours([
    { day: 0, opens: '10:00', closes: '11:30', label: 'Contemporary service' },
    { day: 0, opens: '08:00', closes: '09:00', label: 'Traditional service' },
    { day: 0, opens: '18:00', closes: '19:00', label: '' },
    { day: 1, opens: '09:00', closes: '17:00', label: '' },
  ].sort((a, b) => a.day - b.day || a.opens.localeCompare(b.opens)));
  const sunday = rows[6];
  assert.deepEqual(sunday.lines, ['8am to 9am · Traditional service', '10am to 11:30am · Contemporary service', '6pm to 7pm']);
  assert.equal(sunday.labelled, true);
  assert.equal(rows[0].labelled, false);
  assert.equal(rows[0].text, '9am to 5pm');
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

test('community and attraction places get their own district sections', async () => {
  const { shapePlace, districtSections } = await import('../src/lib/strapi.js');
  const where = { suburb: { slug: 'holder', name: 'Holder' } };
  const church = shapePlace({ slug: 'c', name: 'C', place_class: 'community', primary_category: { slug: 'place-of-worship', plural: 'Places of worship', kind: 'venue' }, location: where });
  const gallery = shapePlace({ slug: 'g', name: 'G', place_class: 'attraction', primary_category: { slug: 'art-gallery', plural: 'Art galleries', kind: 'venue' }, location: where });
  const site = {
    suburbs: [{ slug: 'holder', district: { slug: 'wc' } }],
    categories: [{ slug: 'place-of-worship', plural: 'Places of worship', kind: 'venue', active: true }, { slug: 'art-gallery', plural: 'Art galleries', kind: 'venue', active: true }],
    places: [church, gallery],
  };
  const sections = Object.fromEntries(districtSections(site, { slug: 'wc' }).map((x) => [x.placeClass, x]));
  assert.deepEqual(sections.community.list.map((c) => c.slug), ['place-of-worship']);
  assert.equal(sections.community.key, 'community');
  assert.deepEqual(sections.attraction.list.map((c) => c.slug), ['art-gallery']);
  assert.equal(sections.attraction.key, 'attractions');
  assert.equal(sections.business.list.length, 0);
});

test('post status defaults to loaded and keeps known values', () => {
  assert.equal(shapePlace({ slug: 'a', name: 'A' }).postStatus, 'loaded');
  for (const s of ['online_capture', 'visited', 'complete']) assert.equal(shapePlace({ slug: 'a', name: 'A', post_status: s }).postStatus, s);
  assert.equal(shapePlace({ slug: 'a', name: 'A', post_status: 'info_online' }).postStatus, 'loaded');
});

test('tile sets group the tiles a place has, in set order; other tiles are left for What we know', async () => {
  const { shapeTileSet, tileSetsFor } = await import('../src/lib/format.js');
  const extras = shapeTileSet({ name: 'Extras', heading: 'Extra services', position: 10, active: true, tags: [{ slug: 'ice', label: 'Ice', icon: 'snowflake' }, { slug: 'liquor', label: 'Liquor', icon: 'wine' }, { slug: 'lotto', label: 'Lotto' }] });
  const deli = shapeTileSet({ name: 'Deli', heading: 'At the deli', position: 5, active: true, tags: [{ slug: 'sliced-meats', label: 'Sliced meats' }, { slug: 'liquor', label: 'Liquor' }] });
  const off = shapeTileSet({ name: 'Off', heading: 'Draft', active: false, tags: [{ slug: 'ice', label: 'Ice' }] });
  const place = {
    tileSetChoice: ['Extras', 'Deli', 'Off'],
    facts: [
      { slug: 'liquor', label: 'Liquor', icon: null },
      { slug: 'ice', label: 'Ice', icon: null },
      { slug: 'sliced-meats', label: 'Sliced meats', icon: null },
    ],
  };
  const sets = tileSetsFor(place, [extras, deli, off]);
  assert.deepEqual(sets.map((s) => s.heading), ['At the deli', 'Extra services'], 'lower position first; sets that are off left out');
  assert.deepEqual(sets[0].tiles.map((t) => t.slug), ['sliced-meats', 'liquor']);
  assert.deepEqual(sets[1].tiles.map((t) => t.label), ['Ice'], 'a tile shows once, and removed tiles (Lotto) do not show');
  assert.equal(sets[0].tiles[1].icon, null, 'no icon on the fact or the deli tag');
  assert.equal(sets[1].tiles[0].icon, 'snowflake', "a fact without its own icon uses the tag's");
  assert.equal(tileSetsFor({ ...place, tileSetChoice: [] }, [extras]).length, 0, 'no sets picked: no set sections');
});

test('a place keeps the place it is inside', () => {
  assert.deepEqual(shapePlace({ slug: 'a', name: 'A', parent_place: { slug: 'suite', name: 'Holder Consulting Suite', id: 3 } }).parent, { slug: 'suite', name: 'Holder Consulting Suite' });
  assert.equal(shapePlace({ slug: 'a', name: 'A' }).parent, null);
});

test('a child is hidden from a summary list when its parent is on the same page', async () => {
  const { hideListedChildren } = await import('../src/lib/format.js');
  const suite = { slug: 'suite', parent: null };
  const clinic = { slug: 'clinic', parent: { slug: 'suite' } };
  const shop = { slug: 'shop', parent: null };
  assert.deepEqual(hideListedChildren([suite, clinic, shop]).map((p) => p.slug), ['suite', 'shop']);
  assert.deepEqual(hideListedChildren([clinic, shop]).map((p) => p.slug), ['clinic', 'shop'], 'parent not on the page: the child stays');
  assert.deepEqual(hideListedChildren([clinic], [suite, clinic]).map((p) => p.slug), [], 'parent elsewhere on the same page');
});

test('social media links: https only, in platform order', async () => {
  const { shapeSocials } = await import('../src/lib/strapi.js');
  const s = shapeSocials({
    social_links: [
      { platform: 'facebook', url: 'https://www.facebook.com/a' },
      { platform: 'tiktok', url: 'https://www.tiktok.com/@a' },
      { platform: 'instagram', url: 'https://www.instagram.com/a', handle: '@a' },
      { platform: 'youtube', url: 'http://youtube.com/a' },
      { platform: 'myspace', url: 'https://myspace.com/a' },
    ],
  });
  assert.deepEqual(s.map((l) => l.platform), ['facebook', 'instagram', 'tiktok']);
  assert.equal(s[1].handle, '@a');
  assert.equal(s[2].icon, 'music-2');
});

test('a place inside another place, or in a centre, inherits its tiles', async () => {
  const { inheritFacts, factTile } = await import('../src/lib/format.js');
  const f = (slug, extra = {}) => ({ slug, label: slug, group: 'feature', ...extra });
  const centre = { slug: 'cc', name: 'Cooleman Court', facts: [f('parking'), f('toilets')], tileSetChoice: ['Centre'] };
  const suite = { slug: 'suite', name: 'Consulting Suite', parent: null, centre: { slug: 'cc' }, facts: [f('lift')], tileSetChoice: [] };
  const clinic = { slug: 'clinic', name: 'Clinic', parent: { slug: 'suite' }, centre: null, facts: [f('toilets', { subtitle: 'Ours' })], tileSetChoice: ['Clinic'] };
  const loner = { slug: 'loner', name: 'Loner', parent: null, centre: null, facts: [f('wifi')], tileSetChoice: [] };
  inheritFacts([clinic, suite, loner], [centre]);
  const by = (p) => Object.fromEntries(p.facts.map((x) => [x.slug, x.from ?? null]));
  assert.deepEqual(by(suite), { lift: null, parking: 'Cooleman Court', toilets: 'Cooleman Court' });
  assert.deepEqual(by(clinic), { toilets: null, lift: 'Consulting Suite', parking: 'Cooleman Court' },
    'own tile wins; inherits through the parent up to its centre');
  assert.deepEqual(clinic.tileSetChoice, ['Clinic', 'Centre'], 'tile sets come along too');
  assert.deepEqual(by(loner), { wifi: null }, 'a place on its own is unchanged');
  assert.equal(factTile(clinic.facts.find((x) => x.slug === 'lift')).subtitle, 'From Consulting Suite');
  assert.equal(factTile(clinic.facts.find((x) => x.slug === 'toilets')).subtitle, 'Ours');
  inheritFacts([clinic, suite, loner], [centre]);
  assert.equal(clinic.facts.length, 3, 'running twice adds nothing');
  const a = { slug: 'a', name: 'A', parent: { slug: 'b' }, facts: [f('x')] };
  const b = { slug: 'b', name: 'B', parent: { slug: 'a' }, facts: [f('y')] };
  inheritFacts([a, b]);
  assert.deepEqual(a.facts.map((x) => x.slug).sort(), ['x', 'y'], 'a loop of parents does not hang');
});

test('inherited tiles get their own "At <place>" section and lose the "From" subtitle', async () => {
  const { splitInherited, factTile } = await import('../src/lib/format.js');
  const facts = [
    { slug: 'takeaway', label: 'Takeaway', group: 'feature', section: 'food_drink' },
    { slug: 'toilets', label: 'Toilets', group: 'feature', section: 'facilities', from: 'Cooleman Court' },
    { slug: 'post-box', label: 'Post Box', group: 'feature', section: 'nearby', from: 'Cooleman Court' },
    { slug: 'lift', label: 'Lift', group: 'feature', section: 'access', from: 'Holder Consulting Suite' },
    { slug: 'with-kids', label: 'With kids', group: 'occasion', from: 'Cooleman Court' },
  ];
  const sets = [{ heading: 'Extra services', tiles: [facts[0], facts[2]] }, { heading: 'Only inherited', tiles: [facts[1]] }];
  const out = splitInherited(facts, sets);
  assert.deepEqual(out.facts.map((f) => f.slug), ['takeaway', 'with-kids']);
  assert.deepEqual(out.tileSets.map((s) => [s.heading, s.tiles.map((t) => t.slug)]), [['Extra services', ['takeaway']]]);
  assert.deepEqual(out.inherited.map((s) => [s.heading, s.tiles.map((t) => t.slug)]), [['At Cooleman Court', ['toilets', 'post-box']], ['At Holder Consulting Suite', ['lift']]]);
  assert.equal(factTile(out.inherited[0].tiles[0]).subtitle, '');
});

test('a day switched to Closed shows as Closed, and has no sessions', () => {
  const p = shapePlace({ ...raw, opening_hours: [
    { weekday: 'monday', opens_at: '09:00:00.000', closes_at: '17:00:00.000' }, // saved before the switch: open
    { weekday: 'saturday', open: true, opens_at: '10:00:00.000', closes_at: '14:00:00.000' },
    { weekday: 'sunday', open: false, opens_at: null, closes_at: null },
  ] });
  assert.deepEqual(p.hours.map((h) => h.day), [1, 6]);
  assert.deepEqual(p.closedDays, [0]);
  const week = Object.fromEntries(weekHours(p.hours, p.closedDays).map((d) => [d.day, d.text]));
  assert.equal(week.Sunday, 'Closed');
  assert.equal(week.Tuesday, 'Hours not confirmed');
  assert.match(week.Monday, /9/);
});

test('information tiles keep their order and drop rows with no title or an unknown kind', () => {
  const rows = [{ kind: 'warning', title: 'Steep stairs' }, { kind: 'take_note', title: '' }, { kind: 'bogus', title: 'x' }, { kind: 'information', title: 'Free wifi', details: 'Ask' }];
  assert.deepEqual(shapeInformation(rows), [{ kind: 'warning', title: 'Steep stairs', details: '' }, { kind: 'information', title: 'Free wifi', details: 'Ask' }]);
  assert.deepEqual(shapeInformation(undefined), []);
});

test('build label: short commit, Canberra date and time', async () => {
  const { buildLabel } = await import('../src/lib/build-info.js');
  assert.equal(buildLabel('3f4a828ca05f3b1a4ad213d03612bcff6dc975cd', new Date('2026-11-26T11:19:00Z')), 'Build 3f4a828 · 26 Nov 2026, 10:19 pm');
  assert.equal(buildLabel('', new Date('2026-07-01T00:05:00Z')), 'Build · 1 Jul 2026, 10:05 am');
});

test('titleCase capitalises headings but keeps small words, names and short forms', async () => {
  const { titleCase } = await import('../src/lib/format.js');
  assert.equal(titleCase('places of worship'), 'Places of Worship');
  assert.equal(titleCase('What’s on offer'), 'What’s on Offer');
  assert.equal(titleCase('walk-in centres in Weston'), 'Walk-In Centres in Weston');
  assert.equal(titleCase('Martial arts/dance schools'), 'Martial Arts/Dance Schools');
  assert.equal(titleCase('GPs who service Coombs'), 'GPs Who Service Coombs');
  assert.equal(titleCase('a guide to the area'), 'A Guide to the Area');
  assert.equal(titleCase("We couldn't find that page"), "We Couldn't Find That Page");
  assert.equal(titleCase(''), '');
});

test('groupCategories sorts categories into named groups, Other last, or none when only one group', async () => {
  const { groupCategories } = await import('../src/lib/strapi.js');
  const groups = groupCategories([
    { slug: 'cafe', plural: 'Cafes', group: 'Food and Drink', count: 6 },
    { slug: 'gym', plural: 'Gyms', group: '', count: 3 },
    { slug: 'bakery', plural: 'Bakeries', group: 'food and drink', count: 1 },
    { slug: 'barber', plural: 'Barbers', group: 'Hair and Beauty', count: 1 },
  ]);
  assert.deepEqual(groups.map((g) => [g.name, g.list.map((c) => c.slug), g.count]), [
    ['Food and Drink', ['cafe', 'bakery'], 7],
    ['Hair and Beauty', ['barber'], 1],
    ['Other', ['gym'], 3],
  ]);
  assert.equal(groupCategories([{ slug: 'cafe', group: '', count: 1 }]), null);
});
