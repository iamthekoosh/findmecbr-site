import { defineConfig } from 'astro/config';

// Static pages, built from Strapi. Nothing on the public site talks to Strapi at runtime.
export default defineConfig({
  site: 'https://findmecbr.com.au',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
