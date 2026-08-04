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
  // Caps the answer pool to this channel's top N chatters by eligible
  // message count. Omitted/undefined means no cap (every eligible chatter
  // can be picked).
  topChattersLimit?: number;
  // Subfolder under public/static/tenants/ to read winner/loser images
  // from. Falls back to the shared public/static/winners|losers/
  // directories when omitted or when the tenant folder doesn't exist.
  imagesSlug?: string;
  // Optional sponsor sidebar shown alongside the game (see
  // components/AdSidebar.tsx). Omitting adSidebarImage disables it
  // entirely for that tenant.
  adSidebarImage?: string;
  adSidebarText?: string;
  // Optional extra gif always shown on a win, layered on top of the
  // random winnerImages pick (see components/GameBoard.tsx).
  winnerGif?: string;
  // Optional env var *name* holding this tenant's own DATABASE_URL, so one
  // deployment can serve tenants that keep their game data in separate
  // Postgres databases (see lib/db.ts getPool). Unset means the tenant
  // shares the deployment's DATABASE_URL. Deliberately a name, not a value:
  // connection strings are secrets and belong in env vars, not source.
  databaseUrlEnv?: string;
}

export const TENANTS: Record<string, TenantOverrides> = {
  'whisqeydle.doogl.es': {
    channel: 'whisqey',
    gameName: 'Whisqeydle',
  },
  'hannerdle.doogl.es': {
    channel: 'hanner',
    gameName: 'Hannerdle',
    imagesSlug: 'hanner',
  },
  'freezerdle.doogl.es': {
    channel: 'chillmuri_',
    gameName: 'Freezerdle',
    imagesSlug: 'chillmuri',
  },
};

// Hostnames may arrive with a port (e.g. "localhost:3000") or mixed case;
// normalize before looking the tenant up.
export function getTenantOverrides(host: string | null | undefined): TenantOverrides {
  if (!host) return {};
  const hostname = host.split(':')[0].toLowerCase();
  return TENANTS[hostname] ?? {};
}
