// Lets `?tenant=<hostname>` on a non-production deployment (e.g. a Vercel
// preview build) simulate a production tenant hostname from lib/tenants.ts,
// without a real domain/DNS setup or a header-spoofing browser extension.
// middleware.ts turns the query param into the header below (and persists
// it via cookie so it survives follow-up requests like /api/game/new).
export const PREVIEW_TENANT_HEADER = 'x-preview-tenant-host';
export const PREVIEW_TENANT_COOKIE = 'preview-tenant-host';

// Drop-in replacement for `headers().get('host')` / `req.headers.get('host')`
// that prefers the simulated tenant hostname when middleware has set one.
export function resolveHost(headers: { get(name: string): string | null }): string | null {
  return headers.get(PREVIEW_TENANT_HEADER) || headers.get('host');
}
