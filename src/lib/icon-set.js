// Every Lucide icon (lucide-static 0.460.0, ISC licence, see /lucide-LICENSE.txt), drawn at build time.
// Any icon name Strapi accepts is drawn here, so a new tile or category icon needs no change to the site.
// icons.json is only the small set the browser needs for the search page; it is checked first.
// Strapi checks icon names against the same Lucide version: keep the two in step when upgrading.
import nodes from 'lucide-static/icon-nodes.json' with { type: 'json' };
import picked from './icons.json' with { type: 'json' };

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const draw = (node) => node.map(([tag, attrs]) => `<${tag}${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => ` ${k}="${esc(v)}"`).join('')} />`).join('');

// The inside of the <svg> for one icon, or null when there's no such icon.
export function iconBody(name) {
  if (!name) return null;
  if (Object.hasOwn(picked, name)) return picked[name];
  return Object.hasOwn(nodes, name) ? draw(nodes[name]) : null;
}

export const hasIcon = (name) => iconBody(name) !== null;
