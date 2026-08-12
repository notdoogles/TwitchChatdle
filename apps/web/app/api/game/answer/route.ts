import { NextResponse } from 'next/server';
import { getDailyAnswer } from '@/lib/game';
import { getChannel } from '@/lib/config';
import { resolveHost } from '@/lib/previewTenant';

export const dynamic = 'force-dynamic';

// Optional `?date=YYYY-MM-DD` backfill param for already-created past
// rounds; absent means today.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Public endpoint: returns the day's answer (username + first revealed
// message) so a Google Apps Script can archive each day into a spreadsheet.
// Deliberately unauthenticated -- the owner accepts that anyone who finds
// the endpoint can read the answer without playing.
export async function GET(req: Request) {
  const host = resolveHost(req.headers);
  const channel = getChannel(host);
  if (!channel) {
    return NextResponse.json({ error: 'TWITCH_CHANNEL is not configured on the server.' }, { status: 500 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? undefined;
  if (date !== undefined && !DATE_PATTERN.test(date)) {
    return NextResponse.json({ error: 'The date query param must be YYYY-MM-DD.' }, { status: 400 });
  }

  try {
    const answer = await getDailyAnswer(channel, host, date);
    return NextResponse.json(answer);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load the day's answer.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
