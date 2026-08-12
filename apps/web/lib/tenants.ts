// Multi-tenant layer: lets one deployment serve several streamers on
// different hostnames instead of one deployment per streamer. Tenant config
// lives in a single `TENANTS_JSON` env var (managed in the Vercel UI, not
// committed to source), so adding a tenant is a config change -- no code
// changes, no new env vars.
//
// The value is a JSON object keyed by hostname:
//
//   {
//     "elliebdle.doogl.es": { "channel": "elliebwalker", "gameName": "Elliebdle" }
//   }
//
// Every field is optional and overrides the matching universal env var only
// for requests to that host; anything omitted still falls back to the env
// vars/defaults (see lib/config.ts). Secrets (Twitch credentials, admin
// secret, a per-tenant DATABASE_URL) are safe here because the config lives
// in env, not in source. When TENANTS_JSON is unset or invalid this is
// purely additive -- every config getter falls back to env vars exactly as
// before, so a single-streamer fork/deploy needs zero changes.
//
// To host multiple streamers from one deployment: add an entry per
// hostname to TENANTS_JSON, attach that hostname as a domain on the same
// Vercel project, and drop that tenant's win/loss images in
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
  // Per-tenant Twitch app credentials (SSO + Helix badge images) and admin
  // secret. Previously deliberately not tenant overrides because tenants
  // were committed to source; TENANTS_JSON lives in env, so per-tenant
  // secrets are fine. Omitting them falls back to the universal
  // TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET/ADMIN_SECRET env vars.
  twitchClientId?: string;
  twitchClientSecret?: string;
  adminSecret?: string;
  // This tenant's own Postgres connection string, so one deployment can
  // serve tenants that keep their game data in separate databases (see
  // lib/db.ts getPool). Unset means the tenant shares the deployment's
  // DATABASE_URL. databaseUrlEnv is the legacy variant: the *name* of an
  // env var holding the connection string, so the secret could stay in its
  // own variable; databaseUrl wins when both are present.
  databaseUrl?: string;
  databaseUrlEnv?: string;
}

// Parsed once at module load (module scope survives warm serverless
// invocations) and reused across requests. Tests can seed it directly via
// loadTenants(raw) instead of stubbing env vars.
let tenantsCache: Record<string, TenantOverrides> | null = null;

// Parses and caches the tenant map. `raw` defaults to the TENANTS_JSON env
// var; passing it explicitly is for tests. Malformed JSON or a non-object
// root is logged and treated as an empty map, so a bad paste in the Vercel
// UI degrades to single-tenant mode instead of taking the site down.
export function loadTenants(raw?: string): Record<string, TenantOverrides> {
  const source = raw ?? process.env.TENANTS_JSON;
  let parsed: unknown = {};
  if (source && source.trim() !== '') {
    try {
      parsed = JSON.parse(source);
    } catch (err) {
      console.error('[tenants] TENANTS_JSON is not valid JSON; falling back to single-tenant mode.', err);
      parsed = {};
    }
  }
  tenantsCache =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, TenantOverrides>)
      : {};
  return tenantsCache;
}

// Hostnames may arrive with a port (e.g. "localhost:3000") or mixed case;
// normalize before looking the tenant up.
export function getTenantOverrides(host: string | null | undefined): TenantOverrides {
  if (!host) return {};
  const hostname = host.split(':')[0].toLowerCase();
  return (tenantsCache ?? loadTenants())[hostname] ?? {};
}
