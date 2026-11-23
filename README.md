# Find Me CBR: public site

Canberra, suburb by suburb. Checked. Static pages built with [Astro](https://astro.build) from the Find Me CBR Strapi CMS.

Visitors never reach Strapi. Pages are built ahead of time, so the site stays fast and stays up if the CMS is down. **Alpha:** https://alpha.findmecbr.com.au (noindex, with an alpha banner), behind Cloudflare Access: only allowed emails can sign in, with a one-time code.

How listings work in Strapi is explained in `content-model.md` in the project's planning folder. Decisions and history are in `decisions-log.md` and `changelog.md`.

## Pages

| Page | Address |
|---|---|
| Home (district tiles) | `/` |
| District | `/districts/<district>/`, with Essential services, Services and Businesses sections by place class |
| District category list | `/districts/<district>/<essential-services or services or businesses>/<category>/` |
| Centres by type | `/districts/<district>/<local-shops or shopping-centres or town-centres>/` |
| Suburb | `/suburbs/<slug>/`, with statistics, centres and category tabs |
| Suburb category list | `/suburbs/<slug>/<category>/` |
| Centre directory | `/centres/<slug>/`, every place in it, grouped by category |
| Place | `/places/<slug>/` (published places only) |
| Menu images | `/places/<slug>/menu/` |
| Search, Discover, Services | `/search/`, `/discover/`, `/services/` |
| About, How we check, Privacy, Corrections, Advertise | `/about/` and so on |
| Report, Suggest, Claim forms | `/report/`, `/suggest/`, `/claim/` |

## What a place page shows

1. **Header:** name, post status tag, photos, and a live open status. The status says "Open now", "Closing in X mins", "Opening in X mins" or "Closed", in Canberra time, and opens into the week's hours. A day switched to Closed in Strapi reads "Closed". A day with no hours reads "Hours not confirmed".
2. **Links and buttons:** "Inside [parent]" and "In [centre]" buttons, action tiles, then Directions, Call, Website and Menu, then Social media. All buttons are half the row wide.
3. **Tiles:**
   - Our take
   - Good for (occasion tiles)
   - one section for each of the place's tile sets
   - What we know (other tiles)
   - At [centre or parent]: tiles inherited from where the place is, one section per source
   - Places inside, for a parent place
4. **Footer:** where it is, about, the checked date, and report and claim buttons.

**Tiles** are full-width rows with no border: icon, name (with any subtitle after a middot), and a status circle (✓ Verified, i Info from online, ? Unconfirmed). A one-line key sits under each group.

**List cards** (search, suburb, district, centre directory and Places inside) show no buttons and no checked date.

**Near me** (search) asks the browser for a location, which needs HTTPS. It sorts nearest first, shows each distance, and hides places more than 5 km away unless a 2 / 5 / 10 km / Any chip says otherwise.

A **parent** place (one with places inside) is a container: no website, photos or opening hours. On summary pages, its card lists the places inside, and those children aren't listed separately when the parent is on the same page.

## Build

Needs a **read-only** Strapi token with find and findOne on Category, Centre, District, Place, Suburb, Tag, Tile set, Search synonym and Upload, and nothing else. Locally it's read from `~/.findmecbr/site-token.txt`, or set `STRAPI_TOKEN`. `STRAPI_URL` defaults to `http://localhost:1337`, through the SSH tunnel.

```bash
npm install
npm test
npm run build
```

`SITE_SAMPLE=1 npx astro build --outDir dist-sample` builds from `src/lib/sample-site.json`, which is made-up data, without touching Strapi.

| File | What it does |
|---|---|
| `src/lib/strapi.js` | Loads and shapes everything from Strapi. `LAUNCH_DISTRICTS` sets which districts get every suburb page. |
| `src/lib/format.js` | Display helpers: hours (`weekHours`, with Closed days), evidence circles, tile sets (`tileSetsFor`), inherited tiles (`inheritFacts`, `splitInherited`), hiding children (`hideListedChildren`) |
| `src/lib/live-hours.js` | The live open status, worked out in the browser |
| `src/lib/search.js` | Rules-based search: synonyms (including tile synonyms such as "beer"), hard filters, ranking, and Near me (`NEAR_KM`, sorted by distance) |
| `src/lib/icon-set.js` | Draws any Lucide icon (lucide-static 0.460.0) at build time, so any icon name Strapi accepts shows. Strapi checks names against the same version. |
| `src/lib/icons.json` | The few icons the browser needs for the search page, copied from lucide-static 0.460.0. |
| `server.mjs`, `forms.mjs` | The production server: serves pages, rebuilds in the background on request or nightly at 3 am, and handles the forms. The form spam limit counts by `CF-Connecting-IP`. |

## Running on the server

Coolify app `findmecbr-site`, using the Dockerfile, with the domain `https://alpha.findmecbr.com.au`. The container builds from Strapi on start, then serves on port 4321.

- **In front:** Cloudflare proxies the domain and runs Access. SSL/TLS is Full (strict), to a Let's Encrypt certificate on the server. Access lets `/.well-known/acme-challenge/*` through so the certificate can renew. The Vultr firewall only lets Cloudflare reach ports 80 and 443.

- **Rebuilds:**
  - Strapi asks for a rebuild on internal port 4322, with a shared secret.
  - Requests are collected for 30 seconds.
  - New pages only replace the old ones if the build succeeds.
- **Runtime environment:** `STRAPI_URL=http://findmecbr-strapi:1337`, `STRAPI_TOKEN`, `FORMS_TOKEN`, `REBUILD_SECRET` and `SITE_STAGE=alpha`.

## Rules the site keeps

- Home addresses are hidden when "Show public address" is off.
- Only active action tiles with a checked https link are shown.
- No opening hours means "not confirmed", never "closed". Only a day switched to Closed in Strapi says "Closed".
- Health listings never show an opinion.
- Categories only show when they're switched on in Strapi.
- Status is always shown with words as well as colour.
- Search hard filters need positive evidence. A tile synonym only matches Verified or Info from online tiles.
- Pages that aren't live, or have nothing on them yet, are marked noindex.
- No links to suburbs without a page.
