import fs from 'fs';
import path from 'path';

// Any of these extensions are treated as a valid result image -- the
// winners/losers directories may contain a mix of formats.
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);

export type ResultImageKind = 'winners' | 'losers';

// Lists every image in public/static/<kind>, returning web-servable paths
// (e.g. "/static/winners/foo.png"). Runs server-side against the real
// filesystem -- safe to call from a Server Component (executed at build
// time for a statically rendered page / at request time in dev), but this
// module must not be imported from client components.
export function getResultImages(kind: ResultImageKind): string[] {
  const dir = path.join(process.cwd(), 'public', 'static', kind);

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  return entries
    .filter((name) => ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort()
    .map((name) => `/static/${kind}/${name}`);
}
