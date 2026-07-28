import { pool } from './db';
import { getTwitchClientId, getTwitchClientSecret } from './config';

// Twitch's legacy unauthenticated badges.twitch.tv endpoint (what this
// module originally used) was permanently shut down in June 2023 -- the
// domain no longer resolves at all. The only supported replacement is the
// Helix "Get Global/Channel Chat Badges" API, which requires an app
// access token (Client-Id + OAuth client-credentials grant, no user login
// involved). See lib/config.ts's getTwitchClientId/getTwitchClientSecret
// for how those credentials are configured.
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const GLOBAL_BADGES_URL = 'https://api.twitch.tv/helix/chat/badges/global';
const channelBadgesUrl = (twitchChannelId: string) =>
  `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${twitchChannelId}`;

interface HelixBadgeVersion {
  id: string;
  image_url_1x: string;
  image_url_2x: string;
  image_url_4x: string;
}

interface HelixBadgesResponse {
  data: { set_id: string; versions: HelixBadgeVersion[] }[];
}

// slug -> version id -> version, reshaped from Helix's array response for
// O(1) lookups by the same slug/version pair found in the IRC `badges` tag.
type BadgeSets = Record<string, Record<string, HelixBadgeVersion>>;

interface CachedDisplay {
  fetchedAt: number;
  data: BadgeSets | null;
}

// Badge sets change rarely (a new global badge every few months at most),
// so a warm serverless instance can safely reuse a fetch for a while
// instead of hitting the Helix API on every request.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var badgeDisplayCache: Map<string, CachedDisplay> | undefined;
  // eslint-disable-next-line no-var
  var channelTwitchIdCache: Map<string, string | null> | undefined;
  // eslint-disable-next-line no-var
  var twitchAppToken: { token: string; expiresAt: number } | undefined;
}

const displayCache = global.badgeDisplayCache ?? new Map<string, CachedDisplay>();
global.badgeDisplayCache = displayCache;

const channelIdCache = global.channelTwitchIdCache ?? new Map<string, string | null>();
global.channelTwitchIdCache = channelIdCache;

// Fetches (and caches, refreshing shortly before expiry) an app access
// token via the OAuth client-credentials grant. Returns null -- not an
// error -- when TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET aren't configured,
// so this whole feature is opt-in.
async function getAppAccessToken(forceRefresh = false): Promise<string | null> {
  const clientId = getTwitchClientId();
  const clientSecret = getTwitchClientSecret();
  if (!clientId || !clientSecret) return null;

  if (!forceRefresh && global.twitchAppToken && Date.now() < global.twitchAppToken.expiresAt) {
    return global.twitchAppToken.token;
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string; expires_in: number };
    // Refresh 5 minutes early so an in-flight request never gets caught
    // using a token that just expired.
    global.twitchAppToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
    return global.twitchAppToken.token;
  } catch {
    return null;
  }
}

function toBadgeSets(response: HelixBadgesResponse): BadgeSets {
  const sets: BadgeSets = {};
  for (const set of response.data) {
    sets[set.set_id] = {};
    for (const version of set.versions) {
      sets[set.set_id][version.id] = version;
    }
  }
  return sets;
}

async function fetchBadgeSets(url: string, retryOn401 = true): Promise<BadgeSets | null> {
  const cached = displayCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  const token = await getAppAccessToken();
  const clientId = getTwitchClientId();
  let data: BadgeSets | null = null;
  if (token && clientId) {
    try {
      const res = await fetch(url, {
        headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 && retryOn401) {
        // Token may have been revoked/expired early -- force one refresh
        // and retry before giving up.
        await getAppAccessToken(true);
        return fetchBadgeSets(url, false);
      }
      if (res.ok) data = toBadgeSets((await res.json()) as HelixBadgesResponse);
    } catch {
      // Network hiccups shouldn't break hint rendering -- callers fall
      // back to the text label when no image URL comes back.
      data = null;
    }
  }

  // Cache a failed/disabled fetch too (briefly, via the same TTL) so a
  // flaky API -- or badge images simply being unconfigured -- doesn't get
  // hammered once per request.
  displayCache.set(url, { fetchedAt: Date.now(), data });
  return data;
}

function bestImageUrl(version: HelixBadgeVersion | undefined): string | null {
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

// Live source of truth for "is this slug actually global (or channel-
// scoped)" per Twitch's Helix API, used by lib/badges.ts to classify
// badge slugs Twitch has added since CHANNEL_BADGE_LABELS/
// GLOBAL_BADGE_LABELS were last updated (e.g. "lead_moderator",
// "social-sharing") without needing a code change every time. Returns
// null -- not an empty set -- when the API can't be reached (including
// when TWITCH_CLIENT_ID/SECRET aren't configured), so callers can tell
// "definitely not global" apart from "couldn't check" and fall back to
// the static list instead.
export async function getGlobalBadgeSlugs(): Promise<Set<string> | null> {
  const globalSets = await fetchBadgeSets(GLOBAL_BADGES_URL);
  return globalSets ? new Set(Object.keys(globalSets)) : null;
}

export async function getChannelBadgeSlugs(channel: string): Promise<Set<string> | null> {
  const twitchChannelId = await getTwitchChannelId(channel);
  if (!twitchChannelId) return null;
  const channelSets = await fetchBadgeSets(channelBadgesUrl(twitchChannelId));
  return channelSets ? new Set(Object.keys(channelSets)) : null;
}

// Resolves a badge slug + version (as found in the IRC `badges` tag, e.g.
// {"moderator": "1"}) to an actual image URL. `kind` picks which Helix
// endpoint to try first: channel-specific badges (moderator/vip/
// subscriber/founder/bits/sub-gifter) look there first since that's
// where per-channel sub/bits badge art lives, falling back to the global
// set for anything also listed there (e.g. moderator/vip render the same
// everywhere). Global-only badges (Prime, Partner, Staff, ...) only ever
// need the global set. Returns null (not an error) if no image is found
// -- including when TWITCH_CLIENT_ID/SECRET aren't configured at all --
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
      const channelSets = await fetchBadgeSets(channelBadgesUrl(twitchChannelId));
      const fromChannel = bestImageUrl(channelSets?.[slug]?.[version]);
      if (fromChannel) return fromChannel;
    }
  }

  const globalSets = await fetchBadgeSets(GLOBAL_BADGES_URL);
  return bestImageUrl(globalSets?.[slug]?.[version]);
}
