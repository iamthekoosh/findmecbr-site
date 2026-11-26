// The search results page, rendered in the browser from /data/site.json.
// Filters are chips (buttons). Results use the same card as the rest of the site.
import { search, NEAR_RADII } from './search.js';
import icons from './icons.json';

const PAGE = 10;
const KEYS = ['q', 'cat', 'occ', 'suburb', 'radius', 'step', 'open', 'dogs', 'free', 'has', 'near', 'more'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? icons.store}</svg>`;

function readParams() {
  const u = new URLSearchParams(location.search);
  return Object.fromEntries(KEYS.filter((k) => u.get(k)).map((k) => [k, u.get(k)]));
}

function link(params, changes) {
  const next = { ...params, more: null, ...changes };
  const u = new URLSearchParams();
  for (const k of KEYS) if (next[k] !== null && next[k] !== undefined && next[k] !== '' && next[k] !== false) u.set(k, next[k] === true ? '1' : next[k]);
  const s = u.toString();
  return '/search/' + (s ? '?' + s : '');
}

// Near me: the browser's location, kept only in this tab and never sent to us.
const savedOrigin = () => { try { return JSON.parse(sessionStorage.getItem('fmc-origin') || 'null'); } catch { return null; } };

function nearestSuburb(site, lat, lng) {
  let best = null;
  for (const s of site.suburbs) {
    if (s.lat == null) continue;
    const d = (s.lat - lat) ** 2 + (s.lng - lng) ** 2;
    if (!best || d < best.d) best = { slug: s.slug, d };
  }
  return best?.slug;
}

function describe(c, site) {
  const sub = c.suburb && site.suburbs.find((s) => s.slug === c.suburb)?.name;
  if (c.cat) {
    const cat = site.categories.find((x) => x.slug === c.cat);
    if (c.near) return cat.kind === 'service' ? `${cat.plural} who service your area` : `${cat.plural} near you`;
    if (sub) return cat.kind === 'service' ? `${cat.plural} who service ${sub}` : `${cat.plural} in ${sub}`;
    return cat.plural;
  }
  if (c.occ) {
    const labels = c.occ.split(',').map((s) => site.tags.find((t) => t.slug === s)?.label).filter(Boolean).join(', ') || 'Ideas';
    return labels + (c.near ? ' near you' : sub ? ` in ${sub}` : '');
  }
  if (c.words.length) return `Results for "${c.words.join(' ')}"`;
  return sub ? `Places in ${sub}` : c.near ? 'Places near you' : 'All places';
}

// Same labels as POST_STATUSES in strapi.js (that file isn't loaded in the browser).
const STATUS = { verified: 'Verified', info_online: 'Info from online', unverified: 'Unverified' };

function card(p, site, km) {
  const cat = site.categories.find((c) => c.slug === p.cat);
  const where = [p.centre, p.subName].filter(Boolean).join(', ');
  const sub = [cat?.label, where, km != null ? `${km.toFixed(1)} km` : null].filter(Boolean).join(' · ');
  const initials = p.name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  // No action buttons or checked date in results, so the list stays short. Both are on the place page.
  return `<article class="card">
    <a class="card-head" href="/places/${esc(p.slug)}/"><span class="card-main"><span class="logo-slot">${p.logo ? `<img src="${esc(p.logo)}" alt="" loading="lazy">` : esc(initials)}</span>
      <span><span class="name">${esc(p.name)}</span><span class="card-meta"><span class="status status-${STATUS[p.status] ? p.status : 'unverified'}">${STATUS[p.status] ?? STATUS.unverified}</span></span></span></span>${ic('chevron-right')}</a>
    ${sub ? `<p class="card-sub">${esc(sub)}</p>` : ''}
    ${p.short ? `<p>${esc(p.short)}</p>` : ''}
  </article>`;
}

function chips(params, cond, site) {
  const chip = (key, icon, label) => {
    const on = !!cond[key];
    return `<a class="chip" role="button" aria-pressed="${on}" href="${link(params, { [key]: on ? null : true })}">${ic(icon)}${label}</a>`;
  };
  // Suburbs grouped under a labelled heading for each district, both sorted by name.
  const groups = new Map();
  for (const s of [...site.suburbs].sort((a, b) => a.name.localeCompare(b.name))) {
    const d = s.districtName || 'Other';
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(s);
  }
  const suburbOpts = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([d, subs]) => `<optgroup label="${esc(d)}">${
    subs.map((s) => `<option value="${esc(s.slug)}"${cond.suburb === s.slug ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>`).join('');
  // How far, shown only with Near me.
  const radii = cond.near ? `<div class="locrow wrap" role="group" aria-label="How far">${
    [...NEAR_RADII.map((km) => [String(km), `${km} km`]), ['any', 'Any']].map(([v, label]) => {
      const on = v === 'any' ? cond.radius == null : cond.radius === Number(v);
      return `<a class="chip" role="button" aria-pressed="${on}" href="${link(params, { radius: v })}">${label}</a>`;
    }).join('')}</div>` : '';
  return `<div class="locrow">
      <button class="chip" type="button" id="near-me" aria-pressed="${!!cond.near}">${ic('locate')}Near me</button>
      ${chip('open', 'clock', 'Open now')}
      <select id="suburb-pick" aria-label="Suburb"><option value="">Suburb</option>${suburbOpts}</select>
    </div>${radii}`;
}

function noResults(params, cond, site) {
  const opts = [];
  const off = (key, label) => opts.push(`<a class="btn btn-row" href="${link(params, { [key]: null })}">${label}</a>`);
  if (cond.step) off('step', 'Include places without step-free entry');
  if (cond.open) off('open', 'Include places that may be closed');
  if (cond.dogs) off('dogs', 'Remove the dogs filter');
  if (cond.free) off('free', 'Remove the free filter');
  if (cond.suburb) {
    // Remove the suburb from the typed words too, or it would still apply.
    const name = site.suburbs.find((s) => s.slug === cond.suburb)?.name ?? '';
    const q = params.q ? params.q.replace(new RegExp(`\\b(in|near|servicing|around)?\\s*${name}\\b`, 'i'), ' ').replace(/\s+/g, ' ').trim() : params.q;
    opts.push(`<a class="btn btn-row" href="${link(params, { suburb: null, q })}">Search all suburbs</a>`);
  }
  if (cond.near && cond.radius != null) {
    const wider = NEAR_RADII.find((km) => km > cond.radius);
    opts.push(`<a class="btn btn-row" href="${link(params, { radius: wider ?? 'any' })}">${wider ? `Look within ${wider} km` : 'Look at any distance'}</a>`);
  }
  if (cond.occ?.includes(',')) opts.push(`<a class="btn btn-row" href="${link(params, { occ: cond.occ.split(',')[0] })}">Try fewer ideas</a>`);
  return `<div class="notice">
    <p><b>Nothing matches yet.</b> We only show places we've checked, so some searches come up empty while we're getting started.</p>
    ${opts.join('')}
    <a class="btn btn-row" href="/suggest/">Suggest a place we should check</a>
  </div>`;
}

export async function initSearch() {
  const out = document.getElementById('results');
  const title = document.getElementById('search-title');
  let site;
  try { site = await (await fetch('/data/site.json')).json(); }
  catch { out.innerHTML = '<p class="notice">Search couldn\'t load. Check your connection and try again.</p>'; return; }

  const params = readParams();
  const q = document.getElementById('q');
  if (q && params.q) q.value = params.q;
  const origin = params.near ? savedOrigin() : null;
  const { results, cond, distanceTo } = search(params, site, { origin });
  const hasQuery = Object.keys(params).length > 0;

  title.textContent = hasQuery ? describe(cond, site) : 'Search';
  document.title = `${title.textContent} | Find Me CBR`;
  const shown = params.more ? results.length : Math.min(PAGE, results.length);
  out.innerHTML = `${chips(params, cond, site)}
    ${hasQuery ? `<p class="muted" role="status">${results.length} ${results.length === 1 ? 'result' : 'results'}</p>` : ''}
    ${hasQuery && results.length === 0 ? noResults(params, cond, site) : ''}
    <div class="stack">${results.slice(0, shown).map((p) => card(p, site, distanceTo(p))).join('')}</div>
    ${results.length > shown ? `<a class="btn btn-row" href="${link(params, { more: '1' })}">Show all ${results.length}</a>` : ''}`;

  const locate = () => {
    if (!navigator.geolocation) { alert('This browser can\'t share your location. You can pick a suburb instead.'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const o = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      o.suburb = nearestSuburb(site, o.lat, o.lng);
      try { sessionStorage.setItem('fmc-origin', JSON.stringify(o)); } catch {}
      location.href = link(params, { near: true, suburb: null });
    }, () => { alert('We couldn\'t get your location. You can pick a suburb instead.'); }, { maximumAge: 300000, timeout: 10000 });
  };
  document.getElementById('suburb-pick')?.addEventListener('change', (e) => { location.href = link(params, { suburb: e.target.value || null, near: null, radius: null }); });
  document.getElementById('near-me')?.addEventListener('click', () => {
    if (cond.near) { location.href = link(params, { near: null, radius: null }); return; }
    locate();
  });
  // A Near me link opened in a new tab has no saved location yet, so ask for it.
  if (params.near && !origin) locate();
}
