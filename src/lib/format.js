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

// A fact as a badge: an icon, the fact, and how we know it underneath.
// The tag's own icon is used when it has one, otherwise one that shows the evidence.
export function evidenceBadge(fact, knownIcons = {}) {
  const status = { confirmed: 'Confirmed', business_says: 'Business says' }[fact.evidence] ?? 'Not confirmed';
  const cls = { confirmed: 'yes', business_says: 'biz' }[fact.evidence] ?? 'unk';
  const fallback = { confirmed: 'check', business_says: 'store' }[fact.evidence] ?? 'circle-help';
  const icon = fact.icon && knownIcons[fact.icon] ? fact.icon : fallback;
  return { icon, label: fact.label, status, cls };
}

// Sections for a listing's fact tiles, in the order they appear. Occasion tags go under "Good for".
export const FACT_SECTIONS = [
  ['getting_there', 'Getting there'],
  ['access', 'Access'],
  ['facilities', 'Facilities'],
  ['food_drink', 'Food and drink'],
  ['services', 'Services'],
  ['nearby', 'Nearby'],
  ['other', 'Other features'],
  ['good_for', 'Good for'],
];

export function groupFacts(facts) {
  const known = new Set(FACT_SECTIONS.map(([k]) => k));
  const key = (f) => (f.group === 'occasion' ? 'good_for' : known.has(f.section) ? f.section : 'other');
  return FACT_SECTIONS.map(([k, label]) => ({ key: k, label, facts: facts.filter((f) => key(f) === k) })).filter((g) => g.facts.length);
}

// A maps hand-off for the Directions button. Uses coordinates when the address is public, else the suburb.
export function directionsUrl(place) {
  if (place.lat != null && place.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
  const where = [place.address, place.suburb?.name, 'ACT'].filter(Boolean).join(', ');
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
