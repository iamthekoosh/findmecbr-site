// Rules-based search, carried over from the earlier site (design document SR-001, SR-003, SR-004).
// Hard filters remove places. Preferences only change ranking. Paid placement never affects the score.
// Pure functions, used in the browser with /data/site.json, and tested in tests/search.test.js.

export const WEIGHTS = { match: 0.4, proximity: 0.25, features: 0.2, quality: 0.15 }; // Illustrative, needs testing.
export const PROXIMITY_KM = 10;

// Feature tags the hard filters look for, by slug in Strapi.
export const FILTER_TAGS = { step: 'step-free-entry', dogs: 'dogs-welcome', free: 'free-entry' };

export function kmBetween(aLat, aLng, bLat, bLng) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Canberra local time, so "open now" is right wherever the code runs.
export function canberraNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: days[parts.weekday], time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

// null means unknown, which is never shown as open or closed.
export function isOpenNow(place, now = new Date()) {
  if (!place.hours?.length) return null;
  const { weekday, time } = canberraNow(now);
  return place.hours.some(([d, open, close]) => d === weekday && time >= open && time < close);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, word) => new RegExp('(^|[^a-z0-9é])' + escapeRe(word) + '($|[^a-z0-9é])').test(text);

// Turns typed words into structured conditions.
export function parseQuery(raw, site) {
  let text = (raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const out = {};
  const take = (w) => { text = text.replace(w, ' ').replace(/\s+/g, ' ').trim(); };

  const radius = text.match(/within\s+(\d+)\s*km/);
  if (radius) { out.radius = Number(radius[1]); take(radius[0]); }
  if (/open now/.test(text)) { out.open = true; take('open now'); }

  // Longest phrase first, so "cooleman court" beats "court".
  const terms = [
    ...site.synonyms.map((s) => ({ term: s.term.toLowerCase(), cat: s.category, suburb: s.suburb, tag: s.tag })),
    ...site.suburbs.map((s) => ({ term: s.name.toLowerCase(), suburb: s.slug })),
    ...site.categories.flatMap((c) => [{ term: c.label.toLowerCase(), cat: c.slug }, { term: c.plural.toLowerCase(), cat: c.slug }]),
    ...site.tags.filter((t) => t.group === 'occasion').map((t) => ({ term: t.label.toLowerCase(), occ: t.slug })),
  ].sort((a, b) => b.term.length - a.term.length);

  for (const t of terms) {
    if (!t.term || !hasWord(text, t.term)) continue;
    if (t.suburb && !out.suburb) { out.suburb = t.suburb; take(t.term); }
    else if (t.cat && !out.cat && !out.occ) { out.cat = t.cat; take(t.term); }
    else if (t.occ && !out.occ && !out.cat) { out.occ = t.occ; take(t.term); }
    else if (t.tag === FILTER_TAGS.step) { out.step = true; take(t.term); }
    else if (t.tag === FILTER_TAGS.dogs) { out.dogs = true; take(t.term); }
    else if (t.tag && site.tags.some((x) => x.slug === t.tag && x.group === 'occasion') && !out.occ && !out.cat) { out.occ = t.tag; take(t.term); }
    // A synonym for a tile, such as "beer" for Liquor: places that have that tile.
    else if (t.tag && !site.tags.some((x) => x.slug === t.tag && x.group === 'occasion') && !out.has) { out.has = t.tag; take(t.term); }
  }
  if (/(^|\s)dogs?($|\s)/.test(text)) { out.dogs = true; text = text.replace(/dogs?/, ' '); }
  if (/wheelchair|step[- ]free/.test(text)) { out.step = true; text = text.replace(/wheelchair( access(ible)?)?|step[- ]free/, ' '); }
  out.words = text
    .replace(/\b(servicing|services|service|who|near|nearby|in|at|for|a|an|the|me|my|find|around|with|and|of|good|best|required|access|accessible|open)\b/g, ' ')
    .split(/\s+/).filter((w) => w.length > 1);
  return out;
}

export function search(params, site, opts = {}) {
  const now = opts.now || new Date();
  const parsed = parseQuery(params.q, site);
  const cats = Object.fromEntries(site.categories.map((c) => [c.slug, c]));
  const suburbs = Object.fromEntries(site.suburbs.map((s) => [s.slug, s]));
  const cond = {
    cat: params.cat || parsed.cat || null,
    occ: params.occ || parsed.occ || null,
    suburb: params.suburb || parsed.suburb || null,
    radius: params.radius ? Number(params.radius) : parsed.radius || null,
    step: !!(params.step || parsed.step),
    open: !!(params.open || parsed.open),
    dogs: !!(params.dogs || parsed.dogs),
    free: !!params.free,
    has: params.has || parsed.has || null,
    near: !!params.near && !!opts.origin,
    words: parsed.words,
  };
  if (cond.cat && !cats[cond.cat]) cond.cat = null;
  if (cond.suburb && !suburbs[cond.suburb]) cond.suburb = null;

  const origin = cond.near ? opts.origin : cond.suburb ? { lat: suburbs[cond.suburb].lat, lng: suburbs[cond.suburb].lng, suburb: cond.suburb } : null;
  const isService = cond.cat && cats[cond.cat].kind === 'service';

  const eligible = site.places.filter((p) => {
    if (cond.cat && p.cat !== cond.cat) return false;
    // Several ideas can be combined, e.g. with-kids,outdoors. A place must fit all of them.
    if (cond.occ && !cond.occ.split(',').every((o) => p.occ.includes(o))) return false;
    if (cond.words.length && !cond.cat && !cond.occ) {
      const hay = `${p.name} ${p.short} ${cats[p.cat]?.label ?? ''} ${p.centre ?? ''}`.toLowerCase();
      if (!cond.words.every((w) => hay.includes(w))) return false;
    }
    if (p.type === 'mobile') {
      // A service must confirm it covers the suburb. Its base is not enough.
      if (cond.suburb && !p.areas.includes(cond.suburb)) return false;
      if (cond.near && opts.origin?.suburb && !p.areas.includes(opts.origin.suburb)) return false;
    } else if (cond.suburb && !cond.radius && p.sub !== cond.suburb) {
      return false;
    } else if (origin && cond.radius) {
      if (p.lat == null || kmBetween(origin.lat, origin.lng, p.lat, p.lng) > cond.radius) return false;
    }
    // Hard filters need positive evidence. Missing data never passes.
    if (cond.step && p.facts[FILTER_TAGS.step] !== 'confirmed') return false;
    if (cond.open && isOpenNow(p, now) !== true) return false;
    if (cond.dogs && !['confirmed', 'business_says'].includes(p.facts[FILTER_TAGS.dogs])) return false;
    if (cond.free && p.facts[FILTER_TAGS.free] !== 'confirmed') return false;
    // A tile asked for by name: Verified or Info from online. Unconfirmed tiles don't count.
    if (cond.has && !['confirmed', 'business_says'].includes(p.facts[cond.has])) return false;
    return true;
  });

  const distanceTo = (p) => (origin && p.type !== 'mobile' && p.lat != null ? kmBetween(origin.lat, origin.lng, p.lat, p.lng) : null);
  const score = (p) => {
    const levels = Object.values(p.facts);
    const confirmed = levels.length ? levels.filter((l) => l === 'confirmed').length / levels.length : 0;
    const filled = [p.short, p.phone, p.website, p.hours.length].filter(Boolean).length / 4;
    const match = cond.cat || cond.occ || cond.has ? 1 : cond.words.length ? 0.5 : 0.25;
    const d = isService ? null : distanceTo(p);
    const proximity = d == null ? 0 : Math.max(0, 1 - d / PROXIMITY_KM);
    return WEIGHTS.match * match + WEIGHTS.proximity * proximity + WEIGHTS.features * confirmed + WEIGHTS.quality * filled;
  };
  const results = [...eligible].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  return { results, cond, origin, distanceTo };
}
