import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapePrices, localTime } from '../fuel.mjs';
import { applyFuel, sinceLabel, checkedLabel, districtFuel } from '../src/lib/fuel.js';

const raw = {
  stations: [
    { code: 18806, name: 'Ampol Foodary Weston', address: '49 BRIERLY ST, WESTON ACT 2611' },
    { code: 1, name: 'Somewhere NSW', address: '1 Main St, QUEANBEYAN NSW 2620' },
    { code: 2, name: 'Kambah', address: '3 MARCONI CR, KAMBAH ACT 2902' },
  ],
  prices: [
    { stationcode: 18806, fueltype: 'U91', price: 227.9, lastupdated: '16/11/2026 22:22:26' },
    { stationcode: 18806, fueltype: 'EV', price: 0, lastupdated: '16/11/2026 22:22:26' },
    { stationcode: 1, fueltype: 'U91', price: 199.9, lastupdated: '16/11/2026 22:22:26' },
  ],
};

test('keeps ACT stations only, and leaves out EV', () => {
  const s = shapePrices(raw, '2026-11-24T05:00:00.000Z');
  assert.deepEqual(Object.keys(s.stations).sort(), ['18806', '2']);
  assert.deepEqual(s.stations['18806'].prices, { U91: { price: 227.9, since: '2026-11-16T22:22:26' } });
  assert.equal(localTime('bad'), null);
});

test('labels: date, or the time when it is today; checked time in Canberra', () => {
  assert.equal(sinceLabel('2026-11-16T22:22:26', '2026-11-24'), '16 Nov');
  assert.equal(sinceLabel('2026-11-24T07:42:00', '2026-11-24'), '7:42 am');
  assert.equal(checkedLabel('2026-11-24T05:00:00.000Z'), '4 pm, 24 Nov'); // AEDT, UTC+11
});

test('fills fuel tiles on stations with a code; others are untouched', () => {
  const station = { fuelcheckCode: '18806', facts: [{ slug: 'fuel-u91', label: 'Unleaded 91' }, { slug: 'fuel-p98', label: 'Premium 98' }, { slug: 'ice', label: 'Ice', subtitle: 'Bags' }] };
  const other = { fuelcheckCode: null, facts: [{ slug: 'fuel-u91', label: 'Unleaded 91', subtitle: 'by hand' }] };
  applyFuel([station, other], shapePrices(raw, '2026-11-24T05:00:00.000Z'), '2026-11-24');
  assert.equal(station.facts[0].subtitle, '227.9c · since 16 Nov');
  assert.equal(station.facts[1].subtitle, 'No current price');
  assert.equal(station.facts[2].subtitle, 'Bags');
  assert.equal(other.facts[0].subtitle, 'by hand');
  assert.equal(station.fuel.checked, '4 pm, 24 Nov');
});

test('no saved file: tiles say there is no current price', () => {
  const station = { fuelcheckCode: '18806', facts: [{ slug: 'fuel-u91', label: 'Unleaded 91' }] };
  applyFuel([station], null);
  assert.equal(station.facts[0].subtitle, 'No current price');
  assert.equal(station.fuel.checked, '');
});

test('district list: stations in its suburbs, cheapest first, unpriced last', () => {
  const mk = (name, sub, price) => ({ name, suburb: { slug: sub }, fuel: { checked: 'x' }, facts: [{ slug: 'fuel-u91', label: 'Unleaded 91', price }] });
  const site = { suburbs: [{ slug: 'weston', district: { slug: 'wc' } }, { slug: 'kambah', district: { slug: 'tug' } }],
    places: [mk('B', 'weston', 230), mk('A', 'weston', undefined), mk('C', 'weston', 220), mk('K', 'kambah', 100)] };
  const d = districtFuel(site, { slug: 'wc' });
  assert.deepEqual(d.fuels[0].rows.map((r) => r.place.name), ['C', 'B', 'A']);
});

test('tile sets with only Live Information tiles go to the top', async () => {
  const { splitLive } = await import('../src/lib/format.js');
  const fuel = { heading: 'Fuel prices', tiles: [{ slug: 'fuel-u91', section: 'live_information' }] };
  const extras = { heading: 'Extra services', tiles: [{ slug: 'ice', section: 'services' }] };
  const [live, other] = splitLive([extras, fuel]);
  assert.deepEqual(live.map((s) => s.heading), ['Fuel prices']);
  assert.deepEqual(other.map((s) => s.heading), ['Extra services']);
});
