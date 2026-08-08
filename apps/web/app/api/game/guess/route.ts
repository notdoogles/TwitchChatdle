import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { cookies } from 'next/headers';
import { submitGuess } from '@/lib/game';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { resolveHost } from '@/lib/previewTenant';
import { getRequestContext } from '@/lib/requestContext';
import { logRequest } from '@/lib/requestLog';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const host = resolveHost(req.headers);
  waitUntil(logRequest(getRequestContext(req.headers), '/api/game/guess', host));

  let body: { roundId?: string; guess?: string; guessNumber?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { roundId, guess, guessNumber } = body;
  if (!roundId || typeof guess !== 'string' || !guess.trim() || typeof guessNumber !== 'number') {
    return NextResponse.json(
      { error: 'roundId, a non-empty guess, and guessNumber are required.' },
      { status: 400 }
    );
  }

  try {
    // The signed-in player (if any) so a finished round can be recorded on
    // the leaderboard. Best-effort: an expired/missing session just means no
    // recording, never a grading failure.
    const player = await getSessionUser(cookies().get(SESSION_COOKIE)?.value, host);
    const result = await submitGuess(roundId, guess, guessNumber, host, player?.userId ?? null);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not grade that guess.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
