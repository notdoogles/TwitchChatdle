import { pool } from './db';
import type { RequestContext } from './requestContext';

// Persists a request observability entry. Best-effort: a logging failure
// should never affect gameplay, so errors are swallowed after being logged.
export async function logRequest(context: RequestContext, path: string): Promise<void> {
  try {
    await pool.query(
      'insert into request_log (address, path, referrer, user_agent) values ($1, $2, $3, $4)',
      [context.address, path, context.referrer, context.userAgent],
    );
  } catch (err) {
    console.error('request-observability write failed', err);
  }
}
