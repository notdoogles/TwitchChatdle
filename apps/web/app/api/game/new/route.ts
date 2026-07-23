import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createRound } from '@/lib/game';
import { getChannel } from '@/lib/config';
import { getRequestContext } from '@/lib/requestContext';
import { logRequest } from '@/lib/requestLog';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  waitUntil(logRequest(getRequestContext(req.headers), '/api/game/new'));

  const host = req.headers.get('host');
  const channel = getChannel(host);
  if (!channel) {
    return NextResponse.json({ error: 'TWITCH_CHANNEL is not configured on the server.' }, { status: 500 });
  }

  try {
    const round = await createRound(channel, host);
    return NextResponse.json(round);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not start a round.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
