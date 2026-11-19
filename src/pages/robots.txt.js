// While in alpha, ask search engines to stay away entirely.
import { STAGE } from '../lib/strapi.js';

export function GET() {
  const body = STAGE === 'live'
    ? 'User-agent: *\nAllow: /\n'
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
