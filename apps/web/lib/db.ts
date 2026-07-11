import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

// Vercel serverless functions can reuse a warm module scope between
// invocations, so we cache the pool on `global` to avoid opening a new
// connection (or exhausting Supabase's pooler) on every request.
export const pool =
  global.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });

global.pgPool = pool;
