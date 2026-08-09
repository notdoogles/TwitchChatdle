import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { cookies } from 'next/headers';
import { getLeaderboard, LeaderboardPeriod } from '@/lib/leaderboard';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getChannel } from '@/lib/config';
import { resolveHost } from '@/lib/previewTenant';
import { getRequestContext } from '@/lib/requestContext';
import { logRequest } from '@/lib/requestLog';

export const dynamic = 'force-dynamic';

// Public leaderboard: daily (today's solves, keyed by the puzzle's game
// date, so it resets with the answer), weekly (this ISO week's points), or
// alltime (lifetime points). The signed-in viewer's own row is flagged via
// `isYou` (resolved from the session cookie server-side).
export async function GET(req: Request) {
  const host = resolveHost(req.headers);
  waitUntil(logRequest(getRequestContext(req.headers), '/api/leaderboard', host));

  const channel = getChannel(host);
  if (!channel) {
    return NextResponse.json({ error: 'TWITCH_CHANNEL is not configured on the server.' }, { status: 500 });
  }

  const periodParam = new URL(req.url).searchParams.get('period');
  const period: LeaderboardPeriod = periodParam === 'weekly' || periodParam === 'alltime' ? periodParam : 'daily';

  try {
    const player = await getSessionUser(cookies().get(SESSION_COOKIE)?.value, host);
    const data = await getLeaderboard(channel, period, host, player?.userId ?? null);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load the leaderboard.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
