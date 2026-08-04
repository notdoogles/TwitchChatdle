import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { skipMessage } from '@/lib/game';
import { getRequestContext } from '@/lib/requestContext';
import { logRequest } from '@/lib/requestLog';

export const dynamic = 'force-dynamic';

// Player-facing skip: advances to the next message and consumes one guess,
// revealing the same easy-mode hint a wrong guess would (see skipMessage in
// lib/game.ts).
export async function POST(req: Request) {
  waitUntil(logRequest(getRequestContext(req.headers), '/api/game/skip'));

  let body: { roundId?: string; guessNumber?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { roundId, guessNumber } = body;
  if (!roundId || typeof guessNumber !== 'number') {
    return NextResponse.json({ error: 'roundId and guessNumber are required.' }, { status: 400 });
  }

  try {
    const result = await skipMessage(roundId, guessNumber);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not skip that message.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
