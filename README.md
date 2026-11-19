# Find Me CBR: public site

Canberra, suburb by suburb. Checked. Static pages built with [Astro](https://astro.build) from the Find Me CBR Strapi CMS.

Visitors never reach Strapi. Pages are built ahead of time, so the site stays fast and stays up if the CMS is down.

## Pages

| Page | Address |
|---|---|
| Home | `/` |
| Suburb | `/suburbs/<slug>/` (Weston Creek suburbs, live suburbs, and any with listings) |
| Named place directory | `/centres/<slug>/`, for example Cooleman Court |
| Place | `/places/<slug>/` (published places only) |

## Build

Needs a **read-only** Strapi token with find and findOne on Category, Centre, District, Place, Suburb, Tag and Upload, and nothing else. Locally it's read from `~/.findmecbr/site-token.txt`, or set `STRAPI_TOKEN`. `STRAPI_URL` defaults to `http://localhost:1337`, through the SSH tunnel.

```bash
npm install
npm test
npm run build
```

### Checking pages with sample data

`SITE_SAMPLE=1 npx astro build --outDir dist-sample` builds from `src/lib/sample-site.json`, which is made-up data, without touching Strapi.

## Rules the site keeps

- Home addresses are hidden when "Show public address" is off.
- Only active action tiles with a checked https link are shown.
- No opening hours means "not confirmed", never "closed".
- Health listings never show an opinion.
- Pages that aren't live, or have nothing on them yet, are marked noindex.
- No links to suburbs without a page.
