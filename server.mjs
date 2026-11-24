// Serves the built site, and rebuilds it in the background without downtime.
//
// - Public pages on PORT (default 4321).
// - A rebuild trigger on REBUILD_PORT (default 4322), only reachable inside the server's network.
//   POST /rebuild with header "x-rebuild-secret: <REBUILD_SECRET>". Several calls within
//   REBUILD_DELAY_MS (default 30s) make one rebuild.
// - A nightly rebuild at 3am Canberra time, so dates like sponsorship ends stay correct.
// - Fuel prices from FuelCheck every 4 hours from 12am Canberra time (see fuel.mjs), then a rebuild.
//   Only when FUELCHECK_KEY and FUELCHECK_SECRET are set.
//
// Each build goes into a fresh folder. Pages switch to it only once it has built successfully,
// so a failed build never takes the site down.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { handleForm } from './forms.mjs';
import { fetchFuelPrices, saveFuelPrices, fuelFileAge, FUEL_HOURS } from './fuel.mjs';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 4321);
const REBUILD_PORT = Number(process.env.REBUILD_PORT || 4322);
const SECRET = process.env.REBUILD_SECRET || '';
const DELAY = Number(process.env.REBUILD_DELAY_MS || 30000);

let live = null;           // folder being served
let building = false;
let again = false;         // another rebuild was asked for during a build
let timer = null;
let slot = 0;

const log = (...a) => console.log(new Date().toISOString(), ...a);

function build() {
  if (building) { again = true; return; }
  building = true;
  // Always build into the folder that is not being served. (Flipping a counter would, after a
  // failed build, point back at the live folder and delete it mid-build.)
  slot = live === path.join(ROOT, 'site-0') ? 1 : 0;
  const out = path.join(ROOT, `site-${slot}`);
  fs.rmSync(out, { recursive: true, force: true });
  log(`Building into ${path.basename(out)}…`);
  const started = Date.now();
  // A relative folder name, so a space in the path can't split it.
  const child = spawn('npx', ['astro', 'build', '--outDir', `site-${slot}`], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    building = false;
    if (code === 0 && fs.existsSync(path.join(out, 'index.html'))) {
      live = out;
      log(`Build finished in ${Math.round((Date.now() - started) / 1000)}s. Now serving ${path.basename(out)}.`);
    } else {
      log(`Build failed (exit ${code}). Still serving the previous version.`);
    }
    if (again) { again = false; build(); }
  });
}

function scheduleBuild(reason) {
  log(`Rebuild requested: ${reason}`);
  clearTimeout(timer);
  timer = setTimeout(build, DELAY);
}

// ---------- Public pages
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ics': 'text/calendar; charset=utf-8',
};

function send(res, file, status = 200) {
  const ext = path.extname(file).toLowerCase();
  const hashed = file.includes(`${path.sep}_astro${path.sep}`);
  // Never let a 404 be cached: during a deploy the old and new containers briefly serve
  // different CSS names, and a cached 404 for a stylesheet left pages unstyled for hours.
  const cache = status !== 200 ? 'no-store' : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=60';
  res.writeHead(status, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...(process.env.SITE_STAGE && process.env.SITE_STAGE !== 'live' ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
  });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  if (!live) { res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '30', 'Cache-Control': 'no-store' }); return res.end('Starting up. Try again in a moment.'); }
  if (req.method === 'POST' && /^\/api\/forms\/(report|suggest|claim)$/.test(req.url.split('?')[0])) return handleForm(req, res, live);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(live, p));
  if (!file.startsWith(live)) { res.writeHead(403); return res.end(); }

  // Pages live at /path/index.html. Send /path to /path/ so addresses stay consistent.
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' }); return res.end(); }
    const index = path.join(file, 'index.html');
    if (fs.existsSync(index)) return send(res, index);
  } else if (fs.existsSync(file)) {
    return send(res, file);
  }
  const notFound = path.join(live, '404.html');
  if (fs.existsSync(notFound)) return send(res, notFound, 404);
  res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end('Not found');
}).listen(PORT, '0.0.0.0', () => log(`Serving pages on ${PORT}`));

// ---------- Rebuild trigger, for Strapi
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rebuild' && SECRET && req.headers['x-rebuild-secret'] === SECRET) {
    scheduleBuild('Strapi');
    res.writeHead(202, { 'Content-Type': 'text/plain' });
    return res.end(`Rebuild in ${DELAY / 1000}s`);
  }
  res.writeHead(404); res.end();
}).listen(REBUILD_PORT, '0.0.0.0', () => log(`Rebuild trigger on ${REBUILD_PORT}${SECRET ? '' : ' (off: no REBUILD_SECRET set)'}`));

// ---------- Fuel prices: fetch, save, rebuild. A failed fetch keeps the last saved prices,
// so the pages keep their old "checked" time rather than claiming to be newer.
const FUEL_ON = Boolean(process.env.FUELCHECK_KEY && process.env.FUELCHECK_SECRET);
async function alert(message) {
  // An email to the owner when RESEND_API_KEY and ALERT_EMAIL are set. Otherwise only the log.
  const { RESEND_API_KEY: key, ALERT_EMAIL: to, ALERT_FROM: from = 'alerts@findmecbr.com.au' } = process.env;
  if (!key || !to) return;
  try {
    await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, subject: 'Find Me CBR: fuel prices not updated', text: message }) });
  } catch (e) { log(`Alert email failed: ${e.message}`); }
}
async function updateFuel(reason) {
  try {
    const shaped = await fetchFuelPrices();
    saveFuelPrices(shaped);
    log(`Fuel prices saved (${reason}): ${Object.keys(shaped.stations).length} ACT stations`);
    scheduleBuild('fuel prices');
  } catch (e) {
    log(`Fuel prices not updated (${reason}): ${e.message}. Keeping the last saved prices.`);
    alert(`The ${reason} fuel price fetch failed: ${e.message}. The site is still showing the last saved prices.`);
  }
}

// ---------- Canberra clock: the nightly rebuild at 3am, and fuel prices every 4 hours
let lastNightly = '';
let lastFuel = '';
setInterval(() => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const day = now.toDateString();
  const hour = now.getHours();
  if (hour === 3 && lastNightly !== day) { lastNightly = day; scheduleBuild('nightly'); }
  if (FUEL_ON && FUEL_HOURS.includes(hour) && lastFuel !== `${day} ${hour}`) { lastFuel = `${day} ${hour}`; updateFuel(`${hour}:00`); }
}, 60_000);

// On start, fetch only if the saved prices are more than 4 hours old (the fetch then rebuilds again).
if (FUEL_ON && fuelFileAge() > 4) updateFuel('start-up');
build();
