// Reads everything the public site needs from Strapi, once per build.
// Only published places are read, and Strapi never sends fields marked private.
// Home addresses are removed here when "Show public address" is off.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shapeTileSet, tileSetsFor, inheritFacts } from './format.js';
import { loadFuel, applyFuel } from './fuel.js';

const BASE = (process.env.STRAPI_URL || 'http://localhost:1337').replace(/\/$/, '');

function token() {
  if (process.env.STRAPI_TOKEN) return process.env.STRAPI_TOKEN.trim();
  const file = path.join(os.homedir(), '.findmecbr', 'site-token.txt');
  // The file may hold just the token, or a line like "token = abc123".
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim().replace(/^[^=\s]+\s*=\s*/, '');
  throw new Error('No Strapi token. Set STRAPI_TOKEN, or save a read-only token in ~/.findmecbr/site-token.txt');
}

// Turns { populate: { location: { populate: ['suburb'] } } } into Strapi's bracket query string.
export function toQuery(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') parts.push(toQuery(v, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return parts.filter(Boolean).join('&');
}

// Like getAll, but returns [] when the token isn't allowed to read it, so the site still builds.
async function getOptional(collection, params = {}) {
  try { return await getAll(collection, params); } catch (e) { if (/: 40[134] /.test(e.message)) { console.warn(`Skipping ${collection}: the site token can't read it, or Strapi doesn't have it yet.`); return []; } throw e; }
}

async function getAll(collection, params = {}) {
  const auth = { Authorization: `Bearer ${token()}` };
  const rows = [];
  for (let page = 1; ; page++) {
    const q = toQuery({ ...params, pagination: { page, pageSize: 100 } });
    const res = await fetch(`${BASE}/api/${collection}?${q}`, { headers: auth });
    if (!res.ok) throw new Error(`Strapi ${collection}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    rows.push(...json.data);
    if (page >= (json.meta?.pagination?.pageCount ?? 1)) break;
  }
  return rows;
}

// Images are copied into the site at build time (see src/pages/media/[file].js), because Strapi itself
// isn't reachable from the public internet. Pages point at /media/<file name>.
export const mediaFiles = new Map(); // file name → Strapi URL
const image = (img) => {
  if (!img?.file?.url) return null;
  if (img.file.url.startsWith('/sample/')) return { src: img.file.url, alt: img.alt_text ?? '', credit: img.credit ?? null, width: img.file.width, height: img.file.height };
  const source = img.file.url.startsWith('http') ? img.file.url : BASE + img.file.url;
  const name = source.split('/').pop().split('?')[0];
  mediaFiles.set(name, source);
  return { src: `/media/${name}`, alt: img.alt_text ?? '', credit: img.credit ?? null, width: img.file.width, height: img.file.height };
};

// "alpha" while testing on the server's IP address: every page is noindex and labelled as a test.
// The Menu button: only when it's switched on, checked and complete. A link out, or images shown on our own page.
function shapeMenu(p) {
  const m = p.menu;
  if (!m?.show || !m.checked_at) return null;
  if (m.kind === 'images') {
    const pages = (m.images ?? []).map((file, i) => image({ file, alt_text: file.alternativeText || `${p.name} menu, page ${i + 1}` })).filter(Boolean);
    return pages.length ? { kind: 'images', pages, checkedAt: m.checked_at, validAsOf: m.valid_as_of ?? null } : null;
  }
  return /^https:\/\//.test(m.url ?? '') ? { kind: 'link', url: m.url, checkedAt: m.checked_at, validAsOf: m.valid_as_of ?? null } : null;
}

export const STAGE = process.env.SITE_STAGE || 'live';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// A place's class decides which section of a district page it shows in, in this order.
export const CLASSES = {
  essential_service: { key: 'essential-services', title: 'Essential Services', note: 'Schools, health and public services.' },
  service: { key: 'services', title: 'Services', note: 'Someone does something for you.' },
  business: { key: 'businesses', title: 'Businesses', note: 'Shops, cafes and places that sell things.' },
  community: { key: 'community', title: 'Community', note: 'Parks, community groups, places of worship and non-profits.' },
  attraction: { key: 'attractions', title: 'Attractions', note: 'Museums, galleries and places to visit.' },
};

// How far a listing has been checked, shown as a coloured tag under the name.
// A place saved before the field existed counts as loaded. The four statuses replaced Verified, Info from online
// and Unverified on 27 Nov 2026; the tags come off the site at beta.
export const POST_STATUSES = {
  loaded: { label: 'Loaded', note: 'Added from a list or directory. Not checked yet.' },
  online_capture: { label: 'Online Capture', note: "Checked against the business's own website, socials or other public sources. Not yet visited." },
  visited: { label: 'Visited', note: 'We checked this in person.' },
  complete: { label: 'Complete', note: 'We checked this in person and the listing is finished.' },
};

// A Strapi timestamp (UTC) as the calendar date in Canberra, "2026-11-22".
export function sydneyDate(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

// The three kinds of information tile, with the icon and words shown on the site.
export const INFO_KINDS = {
  information: { label: 'Information', icon: 'info' },
  take_note: { label: 'Take note', icon: 'notebook-pen' },
  warning: { label: 'Warning', icon: 'triangle-alert' },
};
export function shapeInformation(rows) {
  return (rows ?? []).filter((n) => n.title && INFO_KINDS[n.kind]).map((n) => ({ kind: n.kind, title: n.title, details: n.details ?? '' }));
}

// Tiles (facts) on a place or centre: each one's tag and how we know it.
export function shapeFacts(facts) {
  return (facts ?? []).filter((f) => f.tag).map((f) => ({ slug: f.tag.slug, label: f.tag.label, subtitle: f.subtitle ?? '', icon: f.tag.icon ?? null, section: f.tag.section ?? null, group: f.tag.group, question: f.tag.question ?? null, active: f.tag.active !== false }));
}

// Social media platforms in the order their buttons show, with a name and a Lucide icon.
// Lucide has no TikTok logo, so TikTok uses a music note.
export const SOCIAL_PLATFORMS = {
  facebook: { name: 'Facebook', icon: 'facebook' },
  instagram: { name: 'Instagram', icon: 'instagram' },
  tiktok: { name: 'TikTok', icon: 'music-2' },
  youtube: { name: 'YouTube', icon: 'youtube' },
  linkedin: { name: 'LinkedIn', icon: 'linkedin' },
  x: { name: 'X', icon: 'at-sign' },
  other: { name: 'Other page', icon: 'external-link' },
};
const PLATFORM_ORDER = Object.keys(SOCIAL_PLATFORMS);

// A place's social media pages, https only, in platform order.
export function shapeSocials(p) {
  const links = (p.social_links ?? []).filter((l) => SOCIAL_PLATFORMS[l.platform] && /^https:\/\//.test(l.url ?? ''))
    .map((l) => ({ platform: l.platform, url: l.url, handle: l.handle ?? '', ...SOCIAL_PLATFORMS[l.platform] }));
  return links.sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));
}

// Shapes one place for the pages. Exported for tests.
export function shapePlace(p) {
  const loc = p.location ?? null;
  const showAddress = loc ? loc.show_public_address !== false : false;
  return {
    id: p.documentId ?? null,
    slug: p.slug,
    name: p.name,
    // The station's code on FuelCheck. Its fuel tiles get prices at build time (see fuel.js).
    fuelcheckCode: p.fuelcheck_code ? String(p.fuelcheck_code) : null,
    // Tile sets picked on the place (by name). They group its tiles on the page.
    tileSetChoice: (p.tile_sets ?? []).map((s) => s.name),
    otherCategories: (p.other_categories ?? []).map((c) => ({ slug: c.slug })),
    category: p.primary_category ? { slug: p.primary_category.slug, label: p.primary_category.label, plural: p.primary_category.plural, icon: p.primary_category.icon } : null,
    locationType: p.location_type,
    postStatus: POST_STATUSES[p.post_status] ? p.post_status : 'loaded',
    placeClass: CLASSES[p.place_class] ? p.place_class : (p.primary_category?.kind === 'service' ? 'service' : 'business'),
    short: p.description_short ?? '',
    full: p.description_full ?? '',
    ourTake: p.is_health ? '' : (p.our_take ?? ''),
    isHealth: !!p.is_health,
    basedIn: p.based_in ?? '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    website: p.website_url ?? '',
    socials: shapeSocials(p),
    checkedAt: p.checked_at ?? null,
    // When the listing was last changed in Strapi, as a Sydney date.
    updatedAt: sydneyDate(p.updatedAt) ?? p.checked_at ?? null,
    suburb: loc?.suburb ? { slug: loc.suburb.slug, name: loc.suburb.name } : null,
    // The place this one is inside, such as a building. Its children are worked out from the other places.
    parent: p.parent_place?.slug ? { slug: p.parent_place.slug, name: p.parent_place.name } : null,
    // The place group it's in (a building, street or arcade). Groups have no page; the place shows their tiles.
    group: p.place_group?.documentId ? { id: p.place_group.documentId, name: p.place_group.name } : null,
    centre: loc?.in_centre && loc?.centre ? { slug: loc.centre.slug, name: loc.centre.name } : null,
    address: showAddress ? (loc?.public_address ?? '') : '',
    postcode: loc?.postcode ?? '',
    state: loc?.state || 'ACT',
    lat: showAddress && loc?.lat != null ? Number(loc.lat) : null,
    lng: showAddress && loc?.lng != null ? Number(loc.lng) : null,
    serviceAreas: (p.service_areas ?? []).filter((a) => a.suburb).map((a) => ({ slug: a.suburb.slug, name: a.suburb.name })),
    facts: shapeFacts(p.facts),
    // Information tiles, in the owner's order: Information, Take Note or Warning, each with a title and optional details.
    information: shapeInformation(p.information),
    // Open sessions only. A row switched to Closed (open: false) marks that day closed instead.
    // Rows saved before the switch existed have no value and count as open.
    hours: (p.opening_hours ?? [])
      .filter((h) => h.open !== false && (h.all_day || (h.opens_at && h.closes_at)))
      // A 24 hours day is one session from midnight to midnight.
      .map((h) => (h.all_day
        ? { day: WEEKDAYS.indexOf(h.weekday), opens: '00:00', closes: '24:00', label: h.label?.trim() || '' }
        : { day: WEEKDAYS.indexOf(h.weekday), opens: String(h.opens_at).slice(0, 5), closes: String(h.closes_at).slice(0, 5), label: h.label?.trim() || '' }))
      .sort((a, b) => a.day - b.day || a.opens.localeCompare(b.opens)),
    closedDays: [...new Set((p.opening_hours ?? []).filter((h) => h.open === false).map((h) => WEEKDAYS.indexOf(h.weekday)))].sort(),
    exceptions: (p.hours_exceptions ?? []).map((x) => ({ date: x.on_date, closed: x.closed, opens: x.opens_at?.slice(0, 5), closes: x.closes_at?.slice(0, 5), note: x.note ?? '' })),
    actions: (p.action_tiles ?? []).filter((t) => t.active && t.checked_at && /^https:\/\//.test(t.url ?? ''))
      .map((t) => ({ action: t.action, label: t.label, provider: t.provider, url: t.url })),
    // The logo is a plain image: no alt text or permission to fill in.
    logo: p.logo ? image({ file: p.logo, alt_text: p.logo.alternativeText || `${p.name} logo` }) : null,
    menu: shapeMenu(p),
    photos: (p.photos ?? []).map((ph) => ({ ...image(ph), primary: ph.is_primary })).filter((ph) => ph.src)
      .sort((a, b) => Number(b.primary) - Number(a.primary)),
  };
}

let cached;

// Suburbs that get a page: live ones, ones with listings, and every suburb in a launch district.
export const LAUNCH_DISTRICTS = ['weston-creek', 'molonglo-valley'];
export function hasPage(suburb, places) {
  return suburb.live || LAUNCH_DISTRICTS.includes(suburb.district?.slug) || places.some((p) => p.suburb?.slug === suburb.slug);
}

export async function loadSite() {
  if (cached) return cached;
  // Sample data for checking pages locally, without touching Strapi. Never used for a real build.
  if (process.env.SITE_SAMPLE === '1') {
    const sample = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'sample-site.json'), 'utf8'));
    cached = { ...sample, places: sample.places.map(shapePlace), tileSets: (sample.tileSets ?? []).map(shapeTileSet), fuelData: loadFuel(true) };
    return finish(cached);
  }
  const [districts, suburbs, centres, categories, places, tags, synonyms, tileSets, groups] = await Promise.all([
    getAll('districts', { sort: 'name', populate: { hero_image: { populate: ['file'] }, photos: { populate: ['file'] } } }),
    getAll('suburbs', { sort: 'name', populate: { district: true, neighbours: true, stats: true, hero_image: { populate: ['file'] } } }),
    getAll('centres', { sort: 'name', populate: { suburb: true, hero_image: { populate: ['file'] }, facts: { populate: ['tag'] }, tile_sets: true } }),
    getAll('categories', { sort: 'label' }),
    getAll('places', {
      status: 'published',
      sort: 'name',
      populate: {
        primary_category: true,
        other_categories: true,
        location: { populate: ['suburb', 'centre'] },
        service_areas: { populate: ['suburb'] },
        facts: { populate: ['tag'] },
        tile_sets: true,
        parent_place: true,
        place_group: true,
        opening_hours: true,
        hours_exceptions: true,
        action_tiles: true,
        information: true,
        social_links: true,
        menu: { populate: ['images'] },
        logo: true,
        photos: { populate: ['file'] },
      },
    }),
    getOptional('tags', { sort: 'label' }),
    getOptional('search-synonyms', { populate: ['category', 'suburb', 'tag'] }),
    getOptional('tile-sets', { populate: ['categories', 'tags'] }),
    getOptional('place-groups', { populate: { facts: { populate: ['tag'] }, tile_sets: true } }),
  ]);

  const shaped = places.map(shapePlace);
  cached = {
    districts: districts.map((d) => ({
      slug: d.slug, name: d.name, intro: d.intro ?? '', image: image(d.hero_image),
      photos: (d.photos ?? []).map((ph) => ({ ...image(ph), primary: ph.is_primary })).filter((ph) => ph.src),
    })),
    suburbs: suburbs.map((s) => ({
      slug: s.slug, name: s.name, lat: s.lat != null ? Number(s.lat) : null, lng: s.lng != null ? Number(s.lng) : null, district: s.district ? { slug: s.district.slug, name: s.district.name } : null,
      intro: s.intro ?? '', body: s.body ?? '', live: !!s.page_live, checkedAt: s.checked_at ?? null,
      neighbours: (s.neighbours ?? []).map((n) => ({ slug: n.slug, name: n.name })), image: image(s.hero_image),
      stats: (s.stats ?? []).filter((x) => x.value && x.label).map((x) => ({ value: x.value, label: x.label, icon: x.icon ?? null, source: x.source ?? '', year: x.year ?? null, url: (x.source_url ?? '').startsWith('https://') ? x.source_url : null })),
    })),
    centres: centres.map((c) => ({
      slug: c.slug, name: c.name, kind: c.kind, suburb: c.suburb ? { slug: c.suburb.slug, name: c.suburb.name } : null,
      address: c.public_address ?? '', intro: c.intro ?? '', body: c.body ?? '', live: !!c.page_live, image: image(c.hero_image),
      facts: shapeFacts(c.facts), tileSetChoice: (c.tile_sets ?? []).map((s) => s.name),
    })),
    groups: groups.map((g) => ({ id: g.documentId, name: g.name, facts: shapeFacts(g.facts), tileSetChoice: (g.tile_sets ?? []).map((s) => s.name) })),
    categories: categories.map((c) => ({ slug: c.slug, label: c.label, plural: c.plural, kind: c.kind, icon: c.icon, group: (c.group ?? '').trim(), active: !!c.active })),
    places: shaped,
    tags: tags.map((t) => ({ slug: t.slug, label: t.label, group: t.group, question: t.question ?? null, icon: t.icon ?? null, active: !!t.active })),
    tileSets: tileSets.map(shapeTileSet),
    synonyms: synonyms.map((x) => ({ term: x.term, category: x.category?.slug ?? null, suburb: x.suburb?.slug ?? null, tag: x.tag?.slug ?? null })),
    fuelData: loadFuel(),
  };
  return finish(cached);
}

// Marks which suburbs have pages, and drops links to suburbs that don't, so there are no broken links.
function finish(site) {
  const paged = new Set(site.suburbs.filter((s) => hasPage(s, site.places)).map((s) => s.slug));
  site.pagedSuburbs = paged;
  // Parents and children: a parent only counts when it's published too.
  const bySlug = new Map(site.places.map((p) => [p.slug, p]));
  for (const p of site.places) if (p.parent && !bySlug.has(p.parent.slug)) p.parent = null;
  for (const p of site.places) p.children = site.places.filter((c) => c.parent?.slug === p.slug);
  // Prices into the fuel tiles of stations with a FuelCheck code, before tiles are inherited or grouped.
  applyFuel(site.places, site.fuelData);
  // A place inside another place, a place group or a centre inherits its tiles (only published parents count).
  inheritFacts(site.places, site.centres, site.groups ?? []);
  // Each place's tile sections, from the tile sets in Strapi.
  for (const p of site.places) p.tileSets = tileSetsFor(p, site.tileSets ?? []);
  for (const c of site.centres) c.tileSets = tileSetsFor({ facts: c.facts ?? [], tileSetChoice: c.tileSetChoice ?? [] }, site.tileSets ?? []);
  for (const s of site.suburbs) s.neighbours = s.neighbours.filter((n) => paged.has(n.slug));
  for (const p of site.places) p.serviceAreas = p.serviceAreas.map((a) => ({ ...a, hasPage: paged.has(a.slug) }));
  // A centre's district comes from its suburb.
  for (const c of site.centres) c.district = site.suburbs.find((s) => s.slug === c.suburb?.slug)?.district ?? null;
  // District pages exist for districts with a suburb page or a centre.
  site.pagedDistricts = new Set([
    ...site.suburbs.filter((s) => paged.has(s.slug)).map((s) => s.district?.slug),
    ...site.centres.map((c) => c.district?.slug),
  ].filter(Boolean));
  return site;
}

// The data the browser uses for search: published, public fields only.
export function publicData(site) {
  const days = (hours) => hours.map((h) => [h.day, h.opens, h.closes]);
  return {
    suburbs: site.suburbs.filter((s) => site.pagedSuburbs.has(s.slug)).map((s) => ({ slug: s.slug, name: s.name, district: s.district?.slug ?? null, districtName: s.district?.name ?? '', lat: s.lat ?? null, lng: s.lng ?? null })),
    categories: site.categories.filter((c) => c.active).map(({ slug, label, plural, kind, icon }) => ({ slug, label, plural, kind, icon })),
    tags: site.tags.filter((t) => t.active).map(({ slug, label, group, question, icon }) => ({ slug, label, group, question, icon })),
    synonyms: site.synonyms,
    places: site.places.map((p) => ({
      id: p.id, slug: p.slug, name: p.name, status: p.postStatus, cat: p.category?.slug ?? null, type: p.locationType, sub: p.suburb?.slug ?? null, subName: p.suburb?.name ?? '',
      centre: p.centre?.name ?? null, lat: p.lat, lng: p.lng, areas: p.serviceAreas.map((a) => a.slug), short: p.short, phone: p.phone, website: p.website,
      checked: p.checkedAt, hours: days(p.hours), logo: p.logo?.src ?? null,
      facts: Object.fromEntries(p.facts.filter((f) => f.group === 'feature').map((f) => [f.slug, 1])),
      occ: p.facts.filter((f) => f.group === 'occasion' && f.active).map((f) => f.slug),
    })),
  };
}

// Places in one category for one suburb. Services count when they confirmed they serve the suburb.
export function placesFor(site, suburb, category) {
  return site.places.filter((p) => p.category?.slug === category.slug && (
    category.kind === 'service'
      ? p.serviceAreas.some((a) => a.slug === suburb.slug) || p.suburb?.slug === suburb.slug
      : p.suburb?.slug === suburb.slug));
}

// Places in one category across a district, optionally of one class. A service counts if it serves any suburb in the district.
export function placesInDistrict(site, district, category, placeClass = null) {
  const subs = new Set(site.suburbs.filter((x) => x.district?.slug === district.slug).map((x) => x.slug));
  return site.places.filter((p) => p.category?.slug === category.slug && (!placeClass || p.placeClass === placeClass) && (
    subs.has(p.suburb?.slug) || (category.kind === 'service' && p.serviceAreas.some((x) => subs.has(x.slug)))));
}

// The sections of a district page, one per class, each with its switched-on categories that have at least one place of that class.
export function districtSections(site, district) {
  return Object.entries(CLASSES).map(([placeClass, sec]) => ({
    ...sec,
    placeClass,
    list: site.categories.filter((c) => c.active)
      .map((c) => ({ ...c, count: placesInDistrict(site, district, c, placeClass).length }))
      .filter((c) => c.count > 0)
      .sort((x, y) => x.plural.localeCompare(y.plural)),
  }));
}

// A section's categories in dropdown groups, by each category's Group, A to Z with Other last.
// Returns null when there's only one group, so the page shows plain tiles instead of a lone dropdown.
export function groupCategories(list) {
  const groups = new Map();
  for (const c of list) {
    const name = c.group || 'Other';
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, list: [], count: 0 });
    const g = groups.get(key);
    g.list.push(c);
    g.count += c.count ?? 0;
  }
  if (groups.size < 2) return null;
  return [...groups.values()].sort((x, y) => (x.name === 'Other') - (y.name === 'Other') || x.name.localeCompare(y.name));
}

// Places grouped by category, in category order, for directory lists.
export function byCategory(places) {
  const groups = new Map();
  for (const p of places) {
    const key = p.category?.slug ?? 'other';
    if (!groups.has(key)) groups.set(key, { category: p.category ?? { slug: 'other', label: 'Other', plural: 'Other Places', icon: 'store' }, places: [] });
    groups.get(key).places.push(p);
  }
  return [...groups.values()].sort((a, b) => a.category.plural.localeCompare(b.category.plural));
}
