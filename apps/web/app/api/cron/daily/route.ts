import { NextResponse } from 'next/server';
import { createRound } from '@/lib/game';
import { getChannel } from '@/lib/config';
import { loadTenants } from '@/lib/tenants';
import { getConnectionString } from '@/lib/db';
import { refreshChannelStats } from '@/lib/stats';

export const dynamic = 'force-dynamic';
// Heavy once-a-day work (round creation scans the channel's whole message
// history; stats refresh re-runs the six aggregations), so allow longer than
// the default. Hobby max is 60s, Pro max is 300s.
export const maxDuration = 60;

// Daily maintenance endpoint, wired to a Vercel Cron Job in vercel.json
// (05:00 UTC by default; the schedule is a Vercel config change, not code).
// It does the once-per-day heavy work so players never pay for it:
//
// 1. Pre-creates today's round for every channel this deployment serves
//    (createRound is idempotent -- on conflict do nothing -- so the first
//    visitor of the day gets the already-cached path instead of running the
//    candidate-message query). If a tenant's reset hour differs from the
//    cron time, the first visitor's createRound fallback still applies, so
//    this is an optimization, never a correctness dependency.
// 2. Recomputes each channel's /stats snapshot (channel_stats), so the
//    page's visits are single-row reads instead of six full-table scans.
//
// Guarded by CRON_SECRET: Vercel Cron Jobs automatically send
// `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET isn't set the
// endpoint refuses every request, and the same URL can be hit from any
// external cron (e.g. the ingest host) with the same header.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  // Every channel this deployment serves: the single-tenant default plus
  // each tenant's channel. Deduped by (database, channel) so two hostnames
  // sharing a database+channel only run the work once, while tenants with
  // their own databases never skip a channel they own.
  const jobs = new Map<string, { channel: string; host: string | null }>();
  const add = (host: string | null) => {
    const channel = getChannel(host);
    if (!channel) return;
    jobs.set(`${getConnectionString(host) ?? ''}\u0000${channel}`, { channel, host });
  };
  add(null);
  for (const hostname of Object.keys(loadTenants())) add(hostname);

  const results = await Promise.all(
    [...jobs.values()].map(async ({ channel, host }) => {
      try {
        await Promise.all([refreshChannelStats(channel, host), createRound(channel, host)]);
        return { channel, ok: true, error: null };
      } catch (err) {
        console.error(`[cron/daily] job failed for ${channel}:`, err instanceof Error ? err.message : err);
        return { channel, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({
    ok: failed.length === 0,
    channels: results.length,
    failed: failed.length,
    errors: failed.map((r) => ({ channel: r.channel, error: r.error })),
  });
}
