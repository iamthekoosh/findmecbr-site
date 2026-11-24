// Fetches ACT fuel prices from FuelCheck (API.NSW) and saves them for the site build.
// Used by server.mjs every 4 hours. The build reads the saved file (src/lib/fuel.js) and never calls FuelCheck,
// so rebuilds for Strapi publishes or the nightly rebuild can't use up the call budget.
//
// Needs FUELCHECK_KEY and FUELCHECK_SECRET (runtime secrets). Neither is ever logged.
// The file goes to FUEL_FILE (default data/fuel-prices.json). Keep data/ on a storage volume so it survives redeploys.
// FuelCheck data: CC BY 4.0, credited on the pages that show it.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const FUEL_FILE = process.env.FUEL_FILE || path.join(process.cwd(), 'data', 'fuel-prices.json');
const BASE = 'https://api.onegov.nsw.gov.au';

// FuelCheck's own timestamp format, in UTC: "24/11/2026 01:34:50 AM".
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  let h = d.getUTCHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(h)}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${ap}`;
}

// FuelCheck's "lastupdated" is Canberra local time, "16/11/2026 22:22:26". Kept as "2026-11-16T22:22:26".
export function localTime(s = '') {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

// Keeps ACT stations only, as { checkedAt, stations: { code: { name, address, prices: { E10: { price, since } } } } }.
export function shapePrices(data, checkedAt = new Date().toISOString()) {
  const stations = {};
  for (const s of data.stations ?? []) {
    if (!/,\s*[^,]+\s+ACT\s+2[69]\d\d\s*$/i.test(s.address ?? '')) continue;
    stations[String(s.code)] = { name: s.name, address: s.address, prices: {} };
  }
  for (const p of data.prices ?? []) {
    const st = stations[String(p.stationcode)];
    if (st && p.fueltype !== 'EV' && typeof p.price === 'number') st.prices[p.fueltype] = { price: p.price, since: localTime(p.lastupdated) };
  }
  return { checkedAt, source: 'FuelCheck, NSW Government (CC BY 4.0)', stations };
}

export async function fetchFuelPrices({ key = process.env.FUELCHECK_KEY, secret = process.env.FUELCHECK_SECRET } = {}) {
  if (!key || !secret) throw new Error('FUELCHECK_KEY and FUELCHECK_SECRET are not set');
  const t = await fetch(`${BASE}/oauth/client_credential/accesstoken?grant_type=client_credentials`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') },
  });
  if (!t.ok) throw new Error(`FuelCheck token: ${t.status}`);
  const { access_token } = await t.json();
  const r = await fetch(`${BASE}/FuelPriceCheck/v1/fuel/prices`, {
    headers: { apikey: key, Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json; charset=utf-8', transactionid: randomUUID(), requesttimestamp: stamp() },
  });
  if (!r.ok) throw new Error(`FuelCheck prices: ${r.status}`);
  const shaped = shapePrices(await r.json());
  if (!Object.keys(shaped.stations).length) throw new Error('FuelCheck returned no ACT stations');
  return shaped;
}

// Saves to a temporary file first, so a half-written file is never read by a build.
export function saveFuelPrices(shaped, file = FUEL_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(shaped));
  fs.renameSync(file + '.tmp', file);
}

// How old the saved file is, in hours. Infinity if there isn't one.
export function fuelFileAge(file = FUEL_FILE) {
  try { return (Date.now() - Date.parse(JSON.parse(fs.readFileSync(file, 'utf8')).checkedAt)) / 3.6e6; } catch { return Infinity; }
}

// The Canberra hours to fetch at: 12 am, 4 am, 8 am, 12 pm, 4 pm and 8 pm.
export const FUEL_HOURS = [0, 4, 8, 12, 16, 20];
