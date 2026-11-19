// Serves the built site, and rebuilds it in the background without downtime.
//
// - Public pages on PORT (default 4321).
// - A rebuild trigger on REBUILD_PORT (default 4322), only reachable inside the server's network.
//   POST /rebuild with header "x-rebuild-secret: <REBUILD_SECRET>". Several calls within
//   REBUILD_DELAY_MS (default 30s) make one rebuild.
// - A nightly rebuild at 3am Canberra time, so dates like sponsorship ends stay correct.
//
// Each build goes into a fresh folder. Pages switch to it only once it has built successfully,
// so a failed build never takes the site down.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

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
  slot = slot === 0 ? 1 : 0;
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
  res.writeHead(status, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...(process.env.SITE_STAGE && process.env.SITE_STAGE !== 'live' ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
  });
  fs.createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  if (!live) { res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '30' }); return res.end('Starting up. Try again in a moment.'); }
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
  res.writeHead(404); res.end('Not found');
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

// ---------- Nightly rebuild at 3am Canberra time
let lastNightly = '';
setInterval(() => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const day = now.toDateString();
  if (now.getHours() === 3 && lastNightly !== day) { lastNightly = day; scheduleBuild('nightly'); }
}, 60_000);

build();
