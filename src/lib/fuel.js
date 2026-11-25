// Fuel prices on the site, from the file the site server saves every 4 hours (see fuel.mjs).
// The build only reads that file. It never calls FuelCheck.
import fs from 'node:fs';
import path from 'node:path';

// Our fuel tags (Strapi seed data/seed/fuel-prices.json) → FuelCheck fuel codes.
export const FUEL_TAGS = { 'fuel-e10': 'E10', 'fuel-u91': 'U91', 'fuel-p95': 'P95', 'fuel-p98': 'P98', 'fuel-dl': 'DL', 'fuel-pdl': 'PDL', 'fuel-lpg': 'LPG', 'fuel-e85': 'E85' };
export const FUEL_ORDER = Object.values(FUEL_TAGS);

export const FUEL_CREDIT = {
  text: 'Fuel prices from FuelCheck, NSW Government, licensed under CC BY 4.0. Selected for Canberra and reformatted by Find Me CBR.',
  fuelcheck: 'https://www.fuelcheck.nsw.gov.au/',
  licence: 'https://creativecommons.org/licenses/by/4.0/',
};

export function loadFuel(sample = false) {
  const file = sample ? path.join(process.cwd(), 'src', 'lib', 'sample-fuel.json') : (process.env.FUEL_FILE || path.join(process.cwd(), 'data', 'fuel-prices.json'));
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clock = (h, m) => `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'pm' : 'am'}`;

// A Canberra local time "2026-11-16T22:22:26" as "16 Nov", or "10:22 pm today" when it's today.
export function sinceLabel(local, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local ?? '');
  if (!m) return '';
  if (`${m[1]}-${m[2]}-${m[3]}` === today) return `${clock(Number(m[4]), Number(m[5]))} today`;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

// When the prices were fetched, as Canberra time: "4 pm, 24 Nov".
export function checkedLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${clock(Number(parts.hour), Number(parts.minute))}, ${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]}`;
}

export const priceLabel = (cents) => `${cents.toFixed(1)}c`;

// Fills each fuel tile's subtitle with its price: "225.9c · Last change: 16 Nov", or "No current price".
// Only on places with a FuelCheck code; other places keep their tiles as entered.
export function applyFuel(places, fuel, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })) {
  for (const p of places) {
    if (!p.fuelcheckCode) continue;
    const station = fuel?.stations?.[p.fuelcheckCode];
    p.fuel = { checked: fuel ? checkedLabel(fuel.checkedAt) : '', prices: {} };
    for (const f of p.facts) {
      const code = FUEL_TAGS[f.slug];
      if (!code) continue;
      const pr = station?.prices?.[code];
      f.fuel = true;
      if (pr) {
        p.fuel.prices[code] = pr;
        const since = sinceLabel(pr.since, today);
        f.subtitle = `${priceLabel(pr.price)}${since ? ` · Last change: ${since}` : ''}`;
        f.price = pr.price;
      } else {
        f.subtitle = 'No current price';
      }
    }
  }
}

// A district's fuel prices: for each fuel, the stations in its suburbs that sell it, cheapest first.
export function districtFuel(site, district) {
  const subs = new Set(site.suburbs.filter((s) => s.district?.slug === district.slug).map((s) => s.slug));
  const stations = site.places.filter((p) => p.fuel && subs.has(p.suburb?.slug));
  const fuels = FUEL_ORDER.map((code) => {
    const tag = Object.keys(FUEL_TAGS).find((k) => FUEL_TAGS[k] === code);
    const rows = stations.map((p) => ({ place: p, fact: p.facts.find((f) => f.slug === tag) })).filter((r) => r.fact)
      .sort((a, b) => (a.fact.price ?? Infinity) - (b.fact.price ?? Infinity) || a.place.name.localeCompare(b.place.name));
    return { code, label: rows[0]?.fact.label ?? code, rows };
  }).filter((f) => f.rows.length);
  return { stations, fuels, checked: stations.find((p) => p.fuel.checked)?.fuel.checked ?? '' };
}
