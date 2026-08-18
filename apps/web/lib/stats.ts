import { CHANNEL_BADGE_LABELS, GLOBAL_BADGE_LABELS } from './badges';
import { getPool } from './db';

// All-time chat stats for the /stats page, aggregated from the ingest
// tables. Everything is scoped per channel (tenants each read their own
// channel's rows from their own database via getPool(host)).
//
// Emote and word stats come straight from `messages`; color and badge
// stats come from `user_channel_state`, which stores each chatter's *most
// recently observed* IRC tags per channel -- so "top colors" counts how
// many chatters currently have each broad color, not per-message colors
// (the ingest worker doesn't snapshot color/badges per message).

export interface ChannelOverview {
  totalMessages: number;
  totalChatters: number;
  totalEmoteUses: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
}

export interface TopChatter {
  username: string;
  messageCount: number;
}

export interface TopEmote {
  id: string;
  code: string;
  count: number;
  // Twitch's public emoticon CDN (the same URL all chat clients use), keyed
  // by emote id since codes are not unique across Twitch's history.
  imageUrl: string;
}

export interface WordCloudWord {
  word: string;
  count: number;
}

export interface ColorBucket {
  label: string;
  // Representative hex used for the swatch (not the exact colors merged
  // into this bucket -- those vary across the channel's chatters).
  hex: string;
  count: number;
}

export interface TopBadge {
  slug: string;
  label: string;
  count: number;
}

export interface ChannelStats {
  overview: ChannelOverview;
  topChatters: TopChatter[];
  topEmotes: TopEmote[];
  wordCloud: WordCloudWord[];
  topColors: ColorBucket[];
  topChannelBadges: TopBadge[];
  topGlobalBadges: TopBadge[];
}

const LIMIT = 10;
const WORD_CLOUD_LIMIT = 80;

// Emotes are rendered from Twitch's public static CDN using their numeric
// id; the code is kept as a fallback/alt text. The 2.0 size is the largest
// scale Twitch serves for emotes.
export function emoteImageUrl(emoteId: string): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${emoteId}/default/dark/2.0`;
}

// ---------------------------------------------------------------------------
// Name-color bucketing
// ---------------------------------------------------------------------------

interface BucketDef {
  label: string;
  hex: string;
}

// One representative color per bucket the stats page shows. Colors from the
// channel's chatters are mapped into these by hue (see bucketColor), so the
// page can show "Blue: 42 chatters" instead of 200 near-identical hexes.
const COLOR_BUCKETS: BucketDef[] = [
  { label: 'Red', hex: '#ff0000' },
  { label: 'Orange', hex: '#ff7f00' },
  { label: 'Yellow', hex: '#ffd700' },
  { label: 'Green', hex: '#00c853' },
  { label: 'Teal', hex: '#00b8b8' },
  { label: 'Blue', hex: '#2979ff' },
  { label: 'Purple', hex: '#9147ff' },
  { label: 'Pink', hex: '#ff69b4' },
];

const DEFAULT_COLOR: BucketDef = { label: 'Default', hex: '#efeff1' };
const WHITE: BucketDef = { label: 'White', hex: '#ffffff' };
const GREY: BucketDef = { label: 'Grey', hex: '#9e9e9e' };
const BLACK: BucketDef = { label: 'Black', hex: '#000000' };
const OTHER_COLOR: BucketDef = { label: 'Other', hex: '#888888' };

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Maps a chatter's exact chat-color hex (or null for "no custom color",
// which Twitch renders as its default white) into one of the broad color
// buckets. Pure function so it's unit-testable; the SQL side only groups by
// exact hex, this does the friendly grouping.
export function bucketColor(rawHex: string | null | undefined): BucketDef {
  const hex = (rawHex ?? '').trim().toLowerCase();
  if (!hex) return DEFAULT_COLOR;
  if (!HEX_PATTERN.test(hex)) return OTHER_COLOR;

  let full = hex;
  if (hex.length === 4) {
    full = '#' + [...hex.slice(1)].map((c) => c + c).join('');
  }
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);

  // Achromatic colors (Twitch's palette includes white, grey, black).
  if (r === g && g === b) {
    if (r >= 230) return WHITE;
    if (r <= 30) return BLACK;
    return GREY;
  }

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2 / 255;
  const delta = (max - min) / 255;

  if (lightness <= 0.12) return BLACK;
  if (lightness >= 0.92) return WHITE;
  if (delta < 0.1) return GREY;

  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / 255 / delta) % 6;
    else if (max === g) hue = (b - r) / 255 / delta + 2;
    else hue = (r - g) / 255 / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  if (hue < 15 || hue >= 345) return COLOR_BUCKETS[0]; // red
  if (hue < 45) return COLOR_BUCKETS[1]; // orange
  if (hue < 70) return COLOR_BUCKETS[2]; // yellow
  if (hue < 165) return COLOR_BUCKETS[3]; // green
  if (hue < 195) return COLOR_BUCKETS[4]; // teal
  if (hue < 255) return COLOR_BUCKETS[5]; // blue
  if (hue < 290) return COLOR_BUCKETS[6]; // purple
  return COLOR_BUCKETS[7]; // pink
}

// ---------------------------------------------------------------------------
// Badge classification (static lists only -- see lib/badges.ts for the
// full Helix-backed version used by the in-game hints)
// ---------------------------------------------------------------------------

// Splits a badge slug from the raw IRC `badges` tag into channel-specific
// (moderator, VIP, subscriber, ...) vs global (Partner, Prime, Turbo, ...)
// categories, with the display label. Returns null for slugs the static
// lists don't recognize -- same behavior as classifyAllBadges when the
// Helix badge data can't be fetched -- so the stats page never
// mislabels a badge it can't confidently categorize.
export function classifyBadgeSlug(slug: string): { category: 'channel' | 'global'; label: string } | null {
  const channelLabel = CHANNEL_BADGE_LABELS[slug];
  if (channelLabel) return { category: 'channel', label: channelLabel };
  const globalLabel = GLOBAL_BADGE_LABELS[slug];
  if (globalLabel) return { category: 'global', label: globalLabel };
  return null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// Common English words the word cloud skips so it surfaces chat words
// ("lol", "pog", "kek") instead of filler. Inlined into the SQL as a
// NOT IN list; the page could read them from a config/env later if chat
// languages need tuning.
const STOP_WORDS = [
  'a', 'about', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'another', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing',
  'down', 'each', 'else', 'even', 'ever', 'every', 'for', 'from', 'get', 'gets', 'getting', 'got', 'had',
  'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his', 'how', 'if', 'in', 'into', 'is',
  'it', 'its', 'just', 'like', 'me', 'more', 'most', 'my', 'no', 'not', 'now', 'of', 'on', 'one', 'only',
  'or', 'other', 'our', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to',
  'too', 'under', 'up', 'us', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while',
  'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'yes', 'yeah', 'ok', 'okay',
  'hey', 'hi', 'hello', 'bye', 'pls', 'please', 'thx', 'ty', 'thanks', 'thank', 'im', 'youre', 'thats',
  'whats', 'whos', 'lets', 'gonna', 'wanna', 'cuz', 'cause',
].map((w) => `'${w}'`).join(', ');

const STOP_WORDS_SQL = `word not in (${STOP_WORDS})`;

const OVERVIEW_SQL = `select count(distinct m.id)::int as total_messages,
                             count(distinct m.user_id)::int as total_chatters,
                             count(e.id)::int as total_emote_uses,
                             min(m.sent_at) as first_message_at,
                             max(m.sent_at) as last_message_at
                      from messages m
                      left join lateral jsonb_array_elements(coalesce(m.emotes, '[]'::jsonb)) as e(id) on true
                      where m.channel = $1`;

const TOP_CHATTERS_SQL = `select coalesce(u.display_name, u.username) as username, count(*)::int as message_count
                          from messages m
                          join users u on u.id = m.user_id
                          where m.channel = $1
                          group by u.id, coalesce(u.display_name, u.username)
                          order by message_count desc, username asc
                          limit ${LIMIT}`;

const TOP_EMOTES_SQL = `select e->>'id' as id, e->>'code' as code, count(*)::int as count
                        from messages m
                        cross join lateral jsonb_array_elements(coalesce(m.emotes, '[]'::jsonb)) as e
                        where m.channel = $1
                        group by e->>'id', e->>'code'
                        order by count desc, code asc
                        limit ${LIMIT}`;

const WORD_CLOUD_SQL = `select word, count(*)::int as count
                        from messages m
                        cross join lateral regexp_split_to_table(lower(m.message_text), '[^a-z0-9]+') as w(word)
                        where m.channel = $1
                          and length(word) >= 2
                          and word ~ '[a-z]'
                          and ${STOP_WORDS_SQL}
                        group by word
                        order by count desc, word asc
                        limit ${WORD_CLOUD_LIMIT}`;

// Color/badges live on user_channel_state (one row per chatter per channel,
// holding their most recently observed tags), so these count *chatters* per
// color/badge rather than messages. The exact-hex grouping happens in SQL
// and the friendly bucketing in JS (bucketColor).
const COLORS_SQL = `select coalesce(color, '') as color, count(*)::int as chatter_count
                    from user_channel_state
                    where channel = $1
                    group by coalesce(color, '')
                    order by chatter_count desc, color asc`;

const BADGES_SQL = `select b.key as slug, count(*)::int as chatter_count
                    from user_channel_state ucs
                    cross join lateral jsonb_each_text(coalesce(ucs.badges, '{}'::jsonb)) as b(key, value)
                    where ucs.channel = $1
                    group by b.key
                    order by chatter_count desc, b.key asc`;

interface OverviewRow {
  total_messages: number;
  total_chatters: number;
  total_emote_uses: number;
  first_message_at: string | null;
  last_message_at: string | null;
}

interface TopChatterRow {
  username: string;
  message_count: number;
}

interface TopEmoteRow {
  id: string;
  code: string;
  count: number;
}

interface WordRow {
  word: string;
  count: number;
}

interface ColorRow {
  color: string;
  chatter_count: number;
}

interface BadgeRow {
  slug: string;
  chatter_count: number;
}

const byCountDesc = (a: { count: number }, b: { count: number }) =>
  b.count - a.count;

// Runs all six aggregation queries in parallel and assembles the response.
// All-time window: no time filter anywhere (the ingest DB is the archive).
export async function getChannelStats(channel: string, host?: string | null): Promise<ChannelStats> {
  const pool = getPool(host);

  const [overviewRes, chattersRes, emotesRes, wordsRes, colorsRes, badgesRes] = await Promise.all([
    pool.query<OverviewRow>(OVERVIEW_SQL, [channel]),
    pool.query<TopChatterRow>(TOP_CHATTERS_SQL, [channel]),
    pool.query<TopEmoteRow>(TOP_EMOTES_SQL, [channel]),
    pool.query<WordRow>(WORD_CLOUD_SQL, [channel]),
    pool.query<ColorRow>(COLORS_SQL, [channel]),
    pool.query<BadgeRow>(BADGES_SQL, [channel]),
  ]);

  const overview: ChannelOverview = {
    totalMessages: overviewRes.rows[0]?.total_messages ?? 0,
    totalChatters: overviewRes.rows[0]?.total_chatters ?? 0,
    totalEmoteUses: overviewRes.rows[0]?.total_emote_uses ?? 0,
    firstMessageAt: overviewRes.rows[0]?.first_message_at ?? null,
    lastMessageAt: overviewRes.rows[0]?.last_message_at ?? null,
  };

  const topChatters: TopChatter[] = chattersRes.rows.map((r) => ({
    username: r.username,
    messageCount: r.message_count,
  }));

  const topEmotes: TopEmote[] = emotesRes.rows.map((r) => ({
    id: r.id,
    code: r.code,
    count: r.count,
    imageUrl: emoteImageUrl(r.id),
  }));

  const wordCloud: WordCloudWord[] = wordsRes.rows.map((r) => ({
    word: r.word,
    count: r.count,
  }));

  // Merge exact hexes (and the no-custom-color default) into broad buckets.
  const colorBuckets = new Map<string, ColorBucket>();
  for (const row of colorsRes.rows) {
    const bucket = bucketColor(row.color === '' ? null : row.color);
    const existing = colorBuckets.get(bucket.label);
    if (existing) existing.count += row.chatter_count;
    else colorBuckets.set(bucket.label, { ...bucket, count: row.chatter_count });
  }
  const topColors = [...colorBuckets.values()]
    .sort((a, b) => byCountDesc(a, b) || a.label.localeCompare(b.label))
    .slice(0, LIMIT);

  // Split the raw combined badges tag into channel vs global categories.
  const channelBadges = new Map<string, TopBadge>();
  const globalBadges = new Map<string, TopBadge>();
  for (const row of badgesRes.rows) {
    const classified = classifyBadgeSlug(row.slug);
    if (!classified) continue;
    const target = classified.category === 'channel' ? channelBadges : globalBadges;
    const existing = target.get(row.slug);
    if (existing) existing.count += row.chatter_count;
    else target.set(row.slug, { slug: row.slug, label: classified.label, count: row.chatter_count });
  }
  const sortBadges = (a: TopBadge, b: TopBadge) => byCountDesc(a, b) || a.label.localeCompare(b.label);
  const topChannelBadges = [...channelBadges.values()].sort(sortBadges).slice(0, LIMIT);
  const topGlobalBadges = [...globalBadges.values()].sort(sortBadges).slice(0, LIMIT);

  return {
    overview,
    topChatters,
    topEmotes,
    wordCloud,
    topColors,
    topChannelBadges,
    topGlobalBadges,
  };
}
