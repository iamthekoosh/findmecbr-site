// Every Lucide icon (lucide-static 1.70.0, ISC licence, see /lucide-LICENSE.txt), drawn at build time.
// Any icon name Strapi accepts is drawn here, so a new tile or category icon needs no change to the site.
// - icons.json is only the small set the browser needs for the search page; it is checked first.
// - Old names Lucide has since renamed (such as "smile" or "square-parking") still work: the package
//   keeps an SVG file under each old name.
// - brand-icons.json holds the Facebook, Instagram, LinkedIn and YouTube logos, which Lucide removed in
//   1.0. They're copied from lucide-static 0.460.0 (ISC).
// Strapi checks icon names against the same Lucide version: keep the two in step when upgrading.
import fs from 'node:fs';
import path from 'node:path';
import nodes from 'lucide-static/icon-nodes.json' with { type: 'json' };
import picked from './icons.json' with { type: 'json' };
import brands from './brand-icons.json' with { type: 'json' };

const FILES = path.join(process.cwd(), 'node_modules', 'lucide-static', 'icons');

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const draw = (node) => node.map(([tag, attrs]) => `<${tag}${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => ` ${k}="${esc(v)}"`).join('')} />`).join('');

// The inside of an old-name SVG file, or null.
function fromFile(name) {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  const file = path.join(FILES, `${name}.svg`);
  if (!fs.existsSync(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  return m ? m[1].replace(/\s*\n\s*/g, '') : null;
}

// The inside of the <svg> for one icon, or null when there's no such icon.
export function iconBody(name) {
  if (!name) return null;
  if (Object.hasOwn(picked, name)) return picked[name];
  if (Object.hasOwn(nodes, name)) return draw(nodes[name]);
  if (Object.hasOwn(brands, name)) return draw(brands[name]);
  return fromFile(name);
}

export const hasIcon = (name) => iconBody(name) !== null;
