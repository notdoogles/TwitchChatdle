import { Pool } from 'pg';
import { getTenantOverrides } from './tenants';

declare global {
  // eslint-disable-next-line no-var
  var pgPools: Record<string, Pool> | undefined;
}

// Resolves the connection string a request should use: a tenant may declare
// a `databaseUrl` (or the legacy `databaseUrlEnv` name, see lib/tenants.ts)
// so one deployment can serve several tenants with separate Postgres
// databases. Everything else falls back to the shared DATABASE_URL, exactly
// like the single-tenant behavior this replaces. Both are secrets: they
// live in TENANTS_JSON / env vars, never in committed source.
function resolveConnectionString(host?: string | null): string | undefined {
  if (host) {
    const overrides = getTenantOverrides(host);
    // A directly embedded connection string wins; the legacy databaseUrlEnv
    // (name of an env var holding the string) is still honored.
    if (overrides.databaseUrl) return overrides.databaseUrl;
    const envName = overrides.databaseUrlEnv;
    if (envName && process.env[envName]) return process.env[envName];
  }
  return process.env.DATABASE_URL;
}

// Vercel serverless functions can reuse a warm module scope between
// invocations, so pools are cached on `global` (keyed by resolved
// connection string) to avoid opening a new connection (or exhausting a
// Supabase pooler) on every request. Pass the request's hostname (see
// lib/previewTenant.ts resolveHost) so a tenant with its own database gets
// its own pool; omit it for the shared deployment database.
export function getPool(host?: string | null): Pool {
  const connectionString = resolveConnectionString(host);
  const key = connectionString ?? '';
  global.pgPools ??= {};
  if (!global.pgPools[key]) {
    global.pgPools[key] = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return global.pgPools[key];
}

// Default pool for the shared deployment database (DATABASE_URL). Kept for
// call sites without a request host (e.g. tests); gameplay paths should
// prefer getPool(host) so a tenant with its own database is routed there.
export const pool = getPool();
