// Public forms: corrections, suggestions and business claims.
// The browser posts here. We check the message and pass it to Strapi with a token that can only
// create these three kinds of record, so nothing private can be read through this route.
import fs from 'node:fs';
import path from 'node:path';

const STRAPI = (process.env.STRAPI_URL || 'http://localhost:1337').replace(/\/$/, '');
const TOKEN = process.env.FORMS_TOKEN || '';
const MIN_SECONDS = 3;          // People take longer than this to fill in a form. Bots don't.
const LIMIT = 5;                // Per visitor, per window
const WINDOW_MS = 10 * 60 * 1000;
const MAX_BYTES = 10_000;

const hits = new Map();         // visitor → recent submission times. Kept in memory only, never logged.

export function rateLimited(visitor, now = Date.now()) {
  const recent = (hits.get(visitor) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) { hits.set(visitor, recent); return true; }
  recent.push(now); hits.set(visitor, recent);
  return false;
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

// Checks a submission and builds the Strapi record. Returns { errors } or { collection, data }.
export function prepare(kind, body, placeId) {
  const errors = {};
  if (kind === 'report') {
    const what = text(body.what, 2000);
    const contact = text(body.contact, 200);
    if (!what) errors.what = 'Add this so we can check it.';
    if (contact && !isEmail(contact)) errors.contact = "That email doesn't look right. Check it and try again.";
    return Object.keys(errors).length ? { errors } : {
      collection: 'correction-reports',
      data: { issue_type: body.place ? 'Report about a listing' : 'General report', details: what, contact: contact || null, ...(placeId ? { place: placeId } : {}) },
    };
  }
  if (kind === 'suggest') {
    const name = text(body.name, 200); const suburbs = text(body.suburbs, 500); const contact = text(body.contact, 300);
    if (!name) errors.name = 'Add this so we can check it.';
    if (!suburbs) errors.suburbs = 'Add this so we can check it.';
    if (!contact) errors.contact = 'Add this so we can check it.';
    return Object.keys(errors).length ? { errors } : { collection: 'listing-submissions', data: { business_name: name, suburbs_text: suburbs, contact_text: contact } };
  }
  if (kind === 'claim') {
    const person = text(body.person, 200); const email = text(body.email, 200); const role = text(body.role, 200);
    if (!placeId) errors.form = 'Open this form from the business\'s own page, so we know which listing it\'s about.';
    if (!person) errors.person = 'Add this so we can check it.';
    if (!email) errors.email = 'Add this so we can check it.';
    else if (!isEmail(email)) errors.email = "That email doesn't look right. Check it and try again.";
    if (!role) errors.role = 'Add this so we can check it.';
    return Object.keys(errors).length ? { errors } : { collection: 'business-claims', data: { place: placeId, claimant_name: person, claimant_email: email, claimant_role: role } };
  }
  return { errors: { form: 'Unknown form.' } };
}

// Looks up a place's Strapi id from the published site data, so visitors can't point at drafts.
function placeIdFor(liveDir, slug) {
  if (!slug) return null;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(liveDir, 'data', 'site.json'), 'utf8'));
    return data.places.find((p) => p.slug === slug)?.id ?? null;
  } catch { return null; }
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Who sent the form, for the rate limit. Visitors come through Cloudflare, which puts their real address in
// CF-Connecting-IP. The server's firewall only lets Cloudflare in on 80 and 443, so that header can be trusted.
// Without it (local runs), fall back to X-Forwarded-For, then the connection itself.
export function visitorOf(req) {
  const h = req.headers ?? {};
  return String(h['cf-connecting-ip'] ?? h['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();
}

export function handleForm(req, res, liveDir) {
  const kind = req.url.split('?')[0].split('/').pop();
  const visitor = visitorOf(req);
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_BYTES) req.destroy(); else chunks.push(c); });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, { errors: { form: 'Something went wrong. Try again.' } }); }
    // Quietly accept, and drop, anything that fills the hidden field or arrives too fast.
    if (body.website || !(Number(body.elapsed) >= MIN_SECONDS)) return reply(res, 200, { ok: true });
    if (rateLimited(visitor)) return reply(res, 429, { errors: { form: "You've sent a few of these already. Try again in 10 minutes." } });
    const prepared = prepare(kind, body, placeIdFor(liveDir, text(body.place, 200)));
    if (prepared.errors) return reply(res, 422, { errors: prepared.errors });
    if (!TOKEN) return reply(res, 503, { errors: { form: "This form isn't connected yet, so nothing was sent." } });
    try {
      const r = await fetch(`${STRAPI}/api/${prepared.collection}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: prepared.data }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) { console.error(new Date().toISOString(), `Form ${kind} not saved: ${r.status}`); return reply(res, 502, { errors: { form: "We couldn't save that just now. Try again later." } }); }
      return reply(res, 200, { ok: true });
    } catch (e) {
      console.error(new Date().toISOString(), `Form ${kind} not saved: ${e.message}`);
      return reply(res, 502, { errors: { form: "We couldn't save that just now. Try again later." } });
    }
  });
}
