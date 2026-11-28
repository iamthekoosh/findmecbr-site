// Plain-words formatting for dates, hours and tiles. Pure functions, tested in tests/format.test.js.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "2026-11-19" → "19 Nov 2026"
export function shortDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// "07:00" → "7am", "15:30" → "3:30pm", "12:00" → "noon"
export function clock(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (h === 12 && m === 0) return 'noon';
  if (h === 0 && m === 0) return 'midnight';
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

// One row per weekday, Monday first. A day switched to Closed in Strapi says "Closed". Other days with
// no hours say "Hours not confirmed", because no rows means unknown. Returns [] when nothing is recorded.
// closedDays: day numbers (0 = Sunday) marked closed. Open sessions on the same day win.
// A session with a label (a church's "Morning service") reads "9am to 10am · Morning service". lines has
// one entry per session, and labelled says whether any has a label, so a day of named sessions can show
// one session a line.
export function weekHours(hours, closedDays = []) {
  if (!hours?.length && !closedDays.length) return [];
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((day) => {
    const sessions = (hours ?? []).filter((h) => h.day === day);
    const lines = sessions.map((s) => {
      const time = s.opens === '00:00' && s.closes === '24:00' ? '24 hours' : `${clock(s.opens)} to ${clock(s.closes)}`;
      return s.label ? `${time} · ${s.label}` : time;
    });
    const text = lines.length ? lines.join(', ') : closedDays.includes(day) ? 'Closed' : 'Hours not confirmed';
    return { day: DAY_NAMES[day], text, lines: lines.length ? lines : [text], labelled: sessions.some((s) => s.label) };
  });
}

// A fact as a tile: its icon, the fact and an optional subtitle. The tag's own icon is used when it has one,
// otherwise a tick.
// knownIcons: a function that says whether an icon exists, or an object of icons by name.
export function factTile(fact, knownIcons = {}) {
  const known = typeof knownIcons === 'function' ? knownIcons(fact.icon) : knownIcons[fact.icon];
  const icon = fact.icon && known ? fact.icon : 'check';
  const subtitle = (fact.subtitle ?? '').trim() || (fact.from ? `From ${fact.from}` : '');
  return { icon, label: fact.label, subtitle };
}

// A listing shows its facts as one set of tiles, no headings, in this order: getting there first, occasions ("good for") last.
const FACT_ORDER = ["live_information", "getting_there", "access", "facilities", "food_drink", "services", "nearby"];

// Tile sets whose tiles are all in the Live Information section (such as Fuel prices) show together
// at the top of a listing under "Live Information", as full-size tiles. Returns [live, other].
export function splitLive(tileSets = []) {
  const isLive = (s) => s.tiles.length > 0 && s.tiles.every((t) => t.section === 'live_information');
  return [tileSets.filter(isLive), tileSets.filter((s) => !isLive(s))];
}
export function orderFacts(facts) {
  const rank = (f) => (f.group === "occasion" ? 99 : FACT_ORDER.includes(f.section) ? FACT_ORDER.indexOf(f.section) : 50);
  return facts.map((f, i) => [f, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(([f]) => f);
}

// A maps hand-off for the Directions button. Uses coordinates when the address is public, else the suburb.
export function directionsUrl(place) {
  if (place.lat != null && place.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
  const where = [place.address, place.suburb?.name, place.state || 'ACT'].filter(Boolean).join(', ');
  return where ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(where)}` : '';
}

export const telUrl = (phone) => (phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : '');

export const ACTION_WORDS = { book: 'Book', order: 'Order', reserve: 'Reserve', buy: 'Buy', enquire: 'Enquire' };

// Centre types: the label shown in breadcrumbs, the web address of the type page, and its heading.
export const CENTRE_TYPES = {
  local_shops: { label: 'Local Shops', slug: 'local-shops', heading: 'Local Shops' },
  shopping_mall: { label: 'Shopping Centre/Mall', slug: 'shopping-centres', heading: 'Shopping Centres and Malls' },
  town_centre: { label: 'Town Centre', slug: 'town-centres', heading: 'Town Centres' },
};
export const CENTRE_KINDS = Object.fromEntries(Object.entries(CENTRE_TYPES).map(([k, v]) => [k, v.label]));
export const typeOf = (kind) => CENTRE_TYPES[kind] ?? CENTRE_TYPES.local_shops;

// Tile sets come from Strapi. A place's tiles are its facts; the sets picked on the place group them
// under the sets' headings, in the sets' order. Tiles not in any of its sets show under "What we know".
// Only sets that are on are used, lowest position first, and a set with none of its tiles on the place is dropped.
export function shapeTileSet(s) {
  return {
    name: s.name, heading: s.heading, position: s.position ?? 10, active: !!s.active,
    tags: (s.tags ?? []).map((t) => ({ slug: t.slug, label: t.label, icon: t.icon ?? null, section: t.section ?? null })),
  };
}

export function tileSetsFor(place, sets = []) {
  const chosen = place.tileSetChoice ?? [];
  const used = new Set();
  return sets
    .filter((s) => s.active && chosen.includes(s.name))
    .sort((a, b) => a.position - b.position || a.heading.localeCompare(b.heading))
    .map((s) => ({
      heading: s.heading,
      tiles: s.tags.map((tag) => {
        const fact = place.facts.find((f) => f.slug === tag.slug);
        if (!fact || used.has(tag.slug)) return null;
        used.add(tag.slug);
        return { ...fact, icon: fact.icon || tag.icon };
      }).filter(Boolean),
    }))
    .filter((s) => s.tiles.length);
}

// Splits a place's tiles into its own and the inherited ones. Inherited tiles get a section for each place
// they came from, headed "At Cooleman Court", in the order they were inherited (parent place first, then centre).
// They lose `from`, so the tile doesn't also say "From Cooleman Court". Occasions ("Good for") stay as they are.
export function splitInherited(facts = [], tileSets = []) {
  const isInherited = (f) => f.from && f.group !== 'occasion';
  const at = new Map();
  for (const f of facts.filter(isInherited)) {
    if (!at.has(f.from)) at.set(f.from, []);
    const { from, ...own } = f;
    at.get(f.from).push(own);
  }
  return {
    facts: facts.filter((f) => !isInherited(f)),
    tileSets: tileSets.map((s) => ({ ...s, tiles: s.tiles.filter((t) => !isInherited(t)) })).filter((s) => s.tiles.length),
    inherited: [...at].map(([from, tiles]) => ({ heading: `At ${from}`, tiles: orderFacts(tiles) })),
  };
}

// A place inside another place, or in a centre, inherits that place's tiles (facts) and tile sets.
// Its own tile wins.
// Order: the parent place (and its own parents, groups and centre, all the way up), then the place's group, then its centre.
// Inherited tiles carry `from` (the name of the place they came from). Safe to run twice.
export function inheritFacts(places, centres = [], groups = []) {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const bySlug = new Map(places.map((p) => [p.slug, p]));
  const centreBySlug = new Map(centres.map((c) => [c.slug, c]));
  const done = new Map();
  const resolve = (p, seen) => {
    if (done.has(p.slug)) return done.get(p.slug);
    const facts = [...(p.facts ?? [])];
    const sets = [...(p.tileSetChoice ?? [])];
    const take = (from, fromFacts, fromSets) => {
      for (const f of fromFacts) {
        const i = facts.findIndex((x) => x.slug === f.slug);
        const inherited = { ...f, from: f.from ?? from };
        if (i === -1) facts.push(inherited);
      }
      for (const s of fromSets) if (!sets.includes(s)) sets.push(s);
    };
    const parent = p.parent && bySlug.get(p.parent.slug);
    if (parent && !seen.has(parent.slug)) {
      const up = resolve(parent, new Set([...seen, parent.slug]));
      take(parent.name, up.facts, up.tileSetChoice);
    }
    const group = p.group && groupById.get(p.group.id);
    if (group) take(group.name, group.facts ?? [], group.tileSetChoice ?? []);
    const centre = p.centre && centreBySlug.get(p.centre.slug);
    if (centre) take(centre.name, centre.facts ?? [], centre.tileSetChoice ?? []);
    const out = { facts, tileSetChoice: sets };
    done.set(p.slug, out);
    return out;
  };
  const result = places.map((p) => resolve(p, new Set([p.slug])));
  places.forEach((p, i) => { p.facts = result[i].facts; p.tileSetChoice = result[i].tileSetChoice; });
  return places;
}

// Summary pages show a parent place with the places inside it on its card, so a child is left out
// of a list when its parent is shown on the same page. "shown" is every place on the page.
export function hideListedChildren(places, shown = places) {
  const slugs = new Set(shown.map((p) => p.slug));
  return places.filter((p) => !(p.parent && slugs.has(p.parent.slug)));
}

// Headings are in Title Case (owner's rule, 28 Nov 2026). Every word starts with a capital, except small
// joining words that are not first or last. Nothing is lowered except those small words, so names and short forms
// (GPs, EV, McDonald's) stay as written. Each part of a hyphenated or slashed word gets a capital.
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const capital = (w) => w.replace(/^([^\p{L}\p{N}]*)(\p{L})/u, (_, lead, c) => lead + c.toUpperCase());
export function titleCase(text) {
  if (!text) return '';
  const words = String(text).split(/(\s+)/);
  const last = words.length - 1;
  return words.map((word, i) => {
    if (/^\s+$/.test(word)) return word;
    if (i > 0 && i < last && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.split(/([-/])/).map(capital).join('');
  }).join('');
}
