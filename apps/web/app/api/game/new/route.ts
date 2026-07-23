import { NextResponse } from 'next/server';
import { createRound } from '@/lib/game';
import { getChannel } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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
