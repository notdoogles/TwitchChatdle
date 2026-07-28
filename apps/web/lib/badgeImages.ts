import { pool } from './db';

// Twitch's own public Badges API -- unauthenticated, no Client-ID/token
// needed. This is the same source streamdatabase.com's badge lists pull
// their images from, so we hit it directly instead of scraping a
// third-party site. "channel" here means "this channel's badge set",
// which includes both true channel-specific badges (subscriber, founder,
// bits, sub-gifter -- these render differently per broadcaster) and a
// copy of moderator/vip/broadcaster (same image everywhere, but still
// listed per-channel). "global" covers badges with no per-channel
// variant at all (Prime, Turbo, Partner, Staff, ...).
const GLOBAL_DISPLAY_URL = 'https://badges.twitch.tv/v1/badges/global/display';
const channelDisplayUrl = (twitchChannelId: string) =>
  `https://badges.twitch.tv/v1/badges/channels/${twitchChannelId}/display`;

interface BadgeVersion {
  image_url_1x: string;
  image_url_2x: string;
  image_url_4x: string;
}

interface BadgeDisplayResponse {
  badge_sets: Record<string, { versions: Record<string, BadgeVersion> }>;
}

interface CachedDisplay {
  fetchedAt: number;
  data: BadgeDisplayResponse | null;
}

// Badge sets change rarely (a new global badge every few months at most),
// so a warm serverless instance can safely reuse a fetch for a while
// instead of hitting badges.twitch.tv on every request.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var badgeDisplayCache: Map<string, CachedDisplay> | undefined;
  // eslint-disable-next-line no-var
  var channelTwitchIdCache: Map<string, string | null> | undefined;
}

const displayCache = global.badgeDisplayCache ?? new Map<string, CachedDisplay>();
global.badgeDisplayCache = displayCache;

const channelIdCache = global.channelTwitchIdCache ?? new Map<string, string | null>();
global.channelTwitchIdCache = channelIdCache;

async function fetchDisplay(url: string): Promise<BadgeDisplayResponse | null> {
  const cached = displayCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  let data: BadgeDisplayResponse | null = null;
  try {
    const res = await fetch(url);
    if (res.ok) data = (await res.json()) as BadgeDisplayResponse;
  } catch {
    // Network hiccups shouldn't break hint rendering -- callers fall back
    // to the text label when no image URL comes back.
    data = null;
  }

  // Cache a failed fetch too (briefly, via the same TTL) so a flaky
  // badges.twitch.tv doesn't get hammered once per request.
  displayCache.set(url, { fetchedAt: Date.now(), data });
  return data;
}

function bestImageUrl(version: BadgeVersion | undefined): string | null {
  return version?.image_url_4x || version?.image_url_2x || version?.image_url_1x || null;
}

// Looks up this channel's numeric Twitch ID (captured by apps/ingest from
// the `room-id` IRC tag -- see apps/ingest/index.js) so channel-specific
// badge images can be resolved. Returns null if the channel hasn't sent a
// message since the `channels` table was added yet.
async function getTwitchChannelId(channel: string): Promise<string | null> {
  if (channelIdCache.has(channel)) return channelIdCache.get(channel)!;

  let twitchChannelId: string | null = null;
  try {
    const { rows } = await pool.query<{ twitch_channel_id: string }>(
      'select twitch_channel_id from channels where channel = $1',
      [channel]
    );
    twitchChannelId = rows[0]?.twitch_channel_id ?? null;
  } catch {
    twitchChannelId = null;
  }

  channelIdCache.set(channel, twitchChannelId);
  return twitchChannelId;
}

// Resolves a badge slug + version (as found in the IRC `badges` tag, e.g.
// {"moderator": "1"}) to an actual image URL. `kind` picks which display
// endpoint to try first: channel-specific badges (moderator/vip/
// subscriber/founder/bits/sub-gifter) look there first since that's
// where per-channel sub/bits badge art lives, falling back to the global
// set for anything also listed there (e.g. moderator/vip render the same
// everywhere). Global-only badges (Prime, Partner, Staff, ...) only ever
// need the global set. Returns null (not an error) if no image is found,
// so callers can fall back to the plain text label.
export async function resolveBadgeImageUrl(
  kind: 'channel' | 'global',
  slug: string | null,
  version: string | null,
  channel: string
): Promise<string | null> {
  if (!slug || !version) return null;

  if (kind === 'channel') {
    const twitchChannelId = await getTwitchChannelId(channel);
    if (twitchChannelId) {
      const channelData = await fetchDisplay(channelDisplayUrl(twitchChannelId));
      const fromChannel = bestImageUrl(channelData?.badge_sets[slug]?.versions[version]);
      if (fromChannel) return fromChannel;
    }
  }

  const globalData = await fetchDisplay(GLOBAL_DISPLAY_URL);
  return bestImageUrl(globalData?.badge_sets[slug]?.versions[version]);
}
