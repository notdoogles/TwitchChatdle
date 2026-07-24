// Optional multi-tenant layer: lets one deployment serve several streamers
// on different hostnames instead of one deployment per streamer. This is
// purely additive -- when TENANTS is empty (the default), every config
// getter in lib/config.ts falls back to env vars exactly as before, so a
// single-streamer fork/deploy needs zero changes here.
//
// To host multiple streamers from one deployment: add an entry per
// hostname below, attach that hostname as a domain on the same Vercel
// project, and drop that tenant's win/loss images in
// `public/static/tenants/<imagesSlug>/winners|losers/`. See the root
// README's multi-tenant section for the full (non-code) domain/DNS setup.
export interface TenantOverrides {
  channel?: string;
  gameName?: string;
  winnerMessage?: string;
  loserMessage?: string;
  resetHour?: number;
  resetTimezone?: string;
  usernameHintsLimit?: number;
  maxMessageLength?: number;
  maxMessageWords?: number;
  // Subfolder under public/static/tenants/ to read winner/loser images
  // from. Falls back to the shared public/static/winners|losers/
  // directories when omitted or when the tenant folder doesn't exist.
  imagesSlug?: string;
}

export const TENANTS: Record<string, TenantOverrides> = {
  // 'streamer1.example.com': {
  //   channel: 'streamer1',
  //   gameName: 'Streamer1dle',
  //   imagesSlug: 'streamer1',
  // },
};

// Hostnames may arrive with a port (e.g. "localhost:3000") or mixed case;
// normalize before looking the tenant up.
export function getTenantOverrides(host: string | null | undefined): TenantOverrides {
  if (!host) return {};
  const hostname = host.split(':')[0].toLowerCase();
  return TENANTS[hostname] ?? {};
}
