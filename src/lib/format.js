// Plain-words formatting for dates, hours and evidence. Pure functions, tested in tests/format.test.js.

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

// One row per weekday, Monday first. Days with no hours say "Hours not confirmed", never "Closed",
// because no rows means unknown. Returns [] when no hours are recorded at all.
export function weekHours(hours) {
  if (!hours?.length) return [];
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((day) => {
    const sessions = hours.filter((h) => h.day === day);
    return {
      day: DAY_NAMES[day],
      text: sessions.length ? sessions.map((s) => `${clock(s.opens)} to ${clock(s.closes)}`).join(', ') : 'Hours not confirmed',
    };
  });
}

// The identity's evidence wording: "Step-free entry: confirmed", "…: business says yes", "…: not confirmed".
export function evidenceText(fact) {
  if (fact.evidence === 'confirmed') return { mark: '✓', text: `${fact.label}: confirmed`, cls: 'yes' };
  if (fact.evidence === 'business_says') return { mark: '', text: `${fact.label}: business says yes`, cls: 'biz' };
  return { mark: '?', text: `${fact.label}: not confirmed`, cls: 'unk' };
}

// A fact as a tile: its icon, the fact, an optional subtitle, and a colour-coded tag for how we know it.
// The tag's own icon is used when it has one, otherwise one that shows the evidence.
export const EVIDENCE_TAGS = { confirmed: 'Verified', business_says: 'Info from online', unknown: 'Unconfirmed' };
export function evidenceBadge(fact, knownIcons = {}) {
  const status = EVIDENCE_TAGS[fact.evidence] ?? EVIDENCE_TAGS.unknown;
  const cls = { confirmed: 'yes', business_says: 'biz' }[fact.evidence] ?? 'unk';
  const fallback = { confirmed: 'check', business_says: 'globe' }[fact.evidence] ?? 'circle-help';
  const icon = fact.icon && knownIcons[fact.icon] ? fact.icon : fallback;
  return { icon, label: fact.label, subtitle: (fact.subtitle ?? '').trim(), status, cls };
}

// A listing shows its facts as one set of tiles, no headings, in this order: getting there first, occasions ("good for") last.
const FACT_ORDER = ["getting_there", "access", "facilities", "food_drink", "services", "nearby"];
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

// Tile sets come from Strapi: each one names the place types (categories) it applies to and its tiles (tags), in order.
// A place gets every active set that matches its main or other categories, lowest position first,
// unless sets were picked on the place itself: then exactly those (still only active ones).
// Tiles hidden on the place are left out.
// A tile the place has a fact for shows that fact's evidence. One it hasn't shows as unconfirmed,
// or is left out when the set's "show missing" is off. Sets with no tiles to show are dropped.
export function shapeTileSet(s) {
  return {
    name: s.name, heading: s.heading, position: s.position ?? 10, showMissing: s.show_missing !== false, active: !!s.active,
    categories: (s.categories ?? []).map((c) => c.slug),
    tags: (s.tags ?? []).map((t) => ({ slug: t.slug, label: t.label, icon: t.icon ?? null })),
  };
}

export function tileSetsFor(place, sets = []) {
  const cats = new Set([place.category?.slug, ...(place.otherCategories ?? []).map((c) => c.slug)].filter(Boolean));
  const chosen = place.tileSetChoice ?? [];
  const hidden = new Set(place.hiddenTiles ?? []);
  return sets
    .filter((s) => s.active && (chosen.length ? chosen.includes(s.name) : s.categories.some((c) => cats.has(c))))
    .sort((a, b) => a.position - b.position || a.heading.localeCompare(b.heading))
    .map((s) => ({
      heading: s.heading,
      tiles: s.tags.filter((tag) => !hidden.has(tag.slug)).map((tag) => {
        const fact = place.facts.find((f) => f.slug === tag.slug);
        if (fact) return { ...fact, icon: fact.icon || tag.icon };
        return s.showMissing ? { slug: tag.slug, label: tag.label, icon: tag.icon, subtitle: '', evidence: 'unknown' } : null;
      }).filter(Boolean),
    }))
    .filter((s) => s.tiles.length);
}
