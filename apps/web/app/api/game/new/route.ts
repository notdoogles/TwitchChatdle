import { NextResponse } from 'next/server';
import { createRound } from '@/lib/game';

export const dynamic = 'force-dynamic';

export async function POST() {
  const channel = process.env.TWITCH_CHANNEL;
  if (!channel) {
    return NextResponse.json({ error: 'TWITCH_CHANNEL is not configured on the server.' }, { status: 500 });
  }

  try {
    const round = await createRound(channel);
    return NextResponse.json(round);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not start a round.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
