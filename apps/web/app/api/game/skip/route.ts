import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { cookies } from 'next/headers';
import { skipMessage } from '@/lib/game';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { resolveHost } from '@/lib/previewTenant';
import { getRequestContext } from '@/lib/requestContext';
import { logRequest } from '@/lib/requestLog';

export const dynamic = 'force-dynamic';

// Player-facing skip: advances to the next message and consumes one guess,
// revealing the same easy-mode hint a wrong guess would (see skipMessage in
// lib/game.ts).
export async function POST(req: Request) {
  const host = resolveHost(req.headers);
  waitUntil(logRequest(getRequestContext(req.headers), '/api/game/skip', host));

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
    // Same best-effort session resolution as /api/game/guess: a finished
    // round is recorded for the leaderboard when the player is signed in.
    const player = await getSessionUser(cookies().get(SESSION_COOKIE)?.value, host);
    const result = await skipMessage(roundId, guessNumber, host, player?.userId ?? null);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not skip that message.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
