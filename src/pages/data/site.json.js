// The data the browser uses for search and Discover. Published, public fields only.
import { loadSite, publicData } from '../../lib/strapi.js';

export async function GET() {
  const site = await loadSite();
  return new Response(JSON.stringify(publicData(site)), { headers: { 'Content-Type': 'application/json' } });
}
