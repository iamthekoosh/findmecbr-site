// Copies each logo and photo from Strapi into the built site at /media/<file name>.
// Runs only at build time. Visitors never reach Strapi.
import { loadSite, mediaFiles } from '../../lib/strapi.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function getStaticPaths() {
  await loadSite();
  return [...mediaFiles.keys()].map((file) => ({ params: { file } }));
}

function token() {
  if (process.env.STRAPI_TOKEN) return process.env.STRAPI_TOKEN.trim();
  const f = path.join(os.homedir(), '.findmecbr', 'site-token.txt');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().replace(/^[^=\s]+\s*=\s*/, '') : '';
}

export async function GET({ params }) {
  const source = mediaFiles.get(params.file);
  const res = await fetch(source, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`Couldn't copy image ${params.file}: ${res.status}`);
  return new Response(await res.arrayBuffer(), { headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream' } });
}
