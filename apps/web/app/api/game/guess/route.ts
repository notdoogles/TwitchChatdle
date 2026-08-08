import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { submitGuess } from '@/lib/game';
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
    const result = await submitGuess(roundId, guess, guessNumber, host);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not grade that guess.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
