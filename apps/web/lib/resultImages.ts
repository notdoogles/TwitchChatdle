import fs from 'fs';
import path from 'path';

// Any of these extensions are treated as a valid result image -- the
// winners/losers directories may contain a mix of formats.
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);

export type ResultImageKind = 'winners' | 'losers';

// Lists every image in public/static/<kind> (or, when `tenantSlug` is given
// and that tenant has its own images, public/static/tenants/<slug>/<kind>),
// returning web-servable paths. Runs server-side against the real
// filesystem -- safe to call from a Server Component (executed at build
// time for a statically rendered page / at request time in dev), but this
// module must not be imported from client components.
export function getResultImages(kind: ResultImageKind, tenantSlug?: string): string[] {
  if (tenantSlug) {
    const tenantImages = readImageDir(path.join('tenants', tenantSlug, kind), `/static/tenants/${tenantSlug}/${kind}`);
    if (tenantImages.length > 0) return tenantImages;
  }
  return readImageDir(kind, `/static/${kind}`);
}

function readImageDir(relativeDir: string, urlPrefix: string): string[] {
  const dir = path.join(process.cwd(), 'public', 'static', relativeDir);

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  return entries
    .filter((name) => ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort()
    .map((name) => `${urlPrefix}/${name}`);
}
