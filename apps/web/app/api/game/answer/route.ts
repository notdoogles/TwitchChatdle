import { NextResponse } from 'next/server';
import { getDailyAnswer } from '@/lib/game';
import { getAdminSecret, getChannel } from '@/lib/config';
import { resolveHost } from '@/lib/previewTenant';

export const dynamic = 'force-dynamic';

// Optional `?date=YYYY-MM-DD` backfill param for already-created past
// rounds; absent means today.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Admin-only endpoint: returns the day's answer (username + first revealed
// message) so a Google Apps Script can archive each day into a spreadsheet.
// Requires the same `x-admin-secret` header as /api/game/reroll -- the
// answer must never be publicly reachable, or anyone could fetch the day's
// answer without playing. If ADMIN_SECRET isn't set on the server, every
// request is refused rather than defaulting to "open".
export async function GET(req: Request) {
  const host = resolveHost(req.headers);
  const adminSecret = getAdminSecret(host);
  if (!adminSecret || req.headers.get('x-admin-secret') !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

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
