import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { rerollRound } from '@/lib/game';
import { getAdminSecret, getChannel } from '@/lib/config';
import { resolveHost } from '@/lib/previewTenant';
import { getRequestContext } from '@/lib/requestContext';
import { logRequest } from '@/lib/requestLog';

export const dynamic = 'force-dynamic';

// Admin-only endpoint: forces today's round to a different pick, for
// clearing out a round you don't like without waiting for the next daily
// reset. Requires the `x-admin-secret` header to match ADMIN_SECRET --
// if ADMIN_SECRET isn't set on the server, the endpoint refuses every
// request rather than defaulting to "open".
export async function POST(req: Request) {
  waitUntil(logRequest(getRequestContext(req.headers), '/api/game/reroll'));

  const adminSecret = getAdminSecret();
  if (!adminSecret || req.headers.get('x-admin-secret') !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const host = resolveHost(req.headers);
  const channel = getChannel(host);
  if (!channel) {
    return NextResponse.json({ error: 'TWITCH_CHANNEL is not configured on the server.' }, { status: 500 });
  }

  try {
    const round = await rerollRound(channel, host);
    return NextResponse.json(round);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not reroll the round.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
