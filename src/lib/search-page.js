// The search results page, rendered in the browser from /data/site.json.
// Filters are chips (buttons). Results use the same card as the rest of the site.
import { search } from './search.js';
import icons from './icons.json';

const PAGE = 10;
const KEYS = ['q', 'cat', 'occ', 'suburb', 'radius', 'step', 'open', 'dogs', 'free', 'near', 'more'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? icons.store}</svg>`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

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

function card(p, site, km) {
  const cat = site.categories.find((c) => c.slug === p.cat);
  const where = [p.centre, p.subName].filter(Boolean).join(', ');
  const initials = p.name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const dir = p.type === 'physical' && p.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` : '';
  const utils = [
    dir && `<a class="btn" href="${dir}" rel="noopener">${ic('navigation')}Directions</a>`,
    p.phone && `<a class="btn" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${ic('phone')}Call</a>`,
    p.website && `<a class="btn" href="${esc(p.website)}" rel="noopener">${ic('globe')}Website</a>`,
  ].filter(Boolean).join('');
  return `<article class="card">
    <a class="card-head" href="/places/${esc(p.slug)}/"><span class="card-main"><span class="logo-slot">${p.logo ? `<img src="${esc(p.logo)}" alt="" loading="lazy">` : esc(initials)}</span>
      <span><span class="name">${esc(p.name)}</span><span class="sub">${esc([cat?.label, where, km != null ? `${km.toFixed(1)} km` : null].filter(Boolean).join(' · '))}</span></span></span>${ic('chevron-right')}</a>
    ${p.short ? `<p>${esc(p.short)}</p>` : ''}
    ${utils ? `<div class="utils">${utils}</div>` : ''}
    ${p.checked ? `<p class="stamp">Checked ${shortDate(p.checked)}</p>` : ''}
  </article>`;
}

function chips(params, cond, site) {
  const chip = (key, icon, label) => {
    const on = !!cond[key];
    return `<a class="chip" role="button" aria-pressed="${on}" href="${link(params, { [key]: on ? null : true })}">${ic(icon)}${label}</a>`;
  };
  const suburbOpts = site.suburbs.map((s) => `<option value="${esc(s.slug)}"${cond.suburb === s.slug ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  return `<div class="chips">
      ${chip('open', 'clock', 'Open now')}${chip('step', 'accessibility', 'Step-free')}${chip('dogs', 'dog', 'Dogs welcome')}${chip('free', 'ticket', 'Free')}
    </div>
    <div class="locrow">
      <select id="suburb-pick" aria-label="Suburb"><option value="">Any suburb</option>${suburbOpts}</select>
      <button class="chip" type="button" id="near-me" aria-pressed="${!!cond.near}">${ic('locate')}Near me</button>
    </div>`;
}

function noResults(params, cond, site) {
  const opts = [];
  const off = (key, label) => opts.push(`<a class="btn btn-row" href="${link(params, { [key]: null })}">${label}</a>`);
  if (cond.step) off('step', 'Include places without confirmed step-free entry');
  if (cond.open) off('open', 'Include places that may be closed');
  if (cond.dogs) off('dogs', 'Remove the dogs filter');
  if (cond.free) off('free', 'Remove the free filter');
  if (cond.suburb) {
    // Remove the suburb from the typed words too, or it would still apply.
    const name = site.suburbs.find((s) => s.slug === cond.suburb)?.name ?? '';
    const q = params.q ? params.q.replace(new RegExp(`\\b(in|near|servicing|around)?\\s*${name}\\b`, 'i'), ' ').replace(/\s+/g, ' ').trim() : params.q;
    opts.push(`<a class="btn btn-row" href="${link(params, { suburb: null, q })}">Search all suburbs</a>`);
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

  document.getElementById('suburb-pick')?.addEventListener('change', (e) => { location.href = link(params, { suburb: e.target.value || null, near: null }); });
  document.getElementById('near-me')?.addEventListener('click', () => {
    if (params.near) { location.href = link(params, { near: null }); return; }
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const o = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      o.suburb = nearestSuburb(site, o.lat, o.lng);
      try { sessionStorage.setItem('fmc-origin', JSON.stringify(o)); } catch {}
      location.href = link(params, { near: true, suburb: null });
    }, () => { alert('We couldn\'t get your location. You can pick a suburb instead.'); }, { maximumAge: 300000, timeout: 10000 });
  });
}
