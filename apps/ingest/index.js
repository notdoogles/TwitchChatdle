import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import tmi from 'tmi.js';
import pg from 'pg';
import { isExcluded, mergeExcludedUsernames, parseChannels, parseExcludedFromEnv, shouldSkipMessage } from './filters.js';
import { mergeEmoteOccurrences, parseEmotes } from './emotes.js';
import { fetchSeventvEmoteSet, parseSeventvEmotes } from './emotes7tv.js';

// .env lives at the repo root, not in this workspace, so load it explicitly
// rather than relying on dotenv/config's cwd-relative default.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { Pool } = pg;

// TWITCH_CHANNELS (comma-separated) lets one worker log chat for several
// streamers into the same DB; TWITCH_CHANNEL remains the single-channel
// default. tmi.js natively supports joining multiple channels over one IRC
// connection, and every message handler below already receives the
// per-message channel, so no other logic needs to branch on channel count.
const CHANNELS = parseChannels(process.env.TWITCH_CHANNELS, process.env.TWITCH_CHANNEL);
const SKIP_COMMANDS = (process.env.SKIP_COMMANDS ?? 'true').toLowerCase() === 'true';
const EXCLUDED_REFRESH_MS = 60_000;

// ---------------------------------------------------------------------------
// 7TV channel emotes
// ---------------------------------------------------------------------------

// Twitch's IRC `emotes` tag only carries Twitch emotes, so 7TV emotes are
// recovered by matching message tokens against the channel's 7TV emote set
// (fetched from the public v3 API, keyed by the channel's numeric Twitch
// user id -- the same `room-id` tag used for the channels table). The set
// is cached in memory per channel and refreshed periodically; this is a
// long-running worker (not serverless), so no shared cache is needed. If
// this ever runs as multiple ingest instances for the same channels,
// mirror the badge-images pattern and add a shared KV layer.
//
// Emotes are captured at ingest time, not render time, so messages keep
// the emote set that was live when they were logged. A channel with no
// 7TV set (404) or a transient failure just yields Twitch-only emotes for
// that refresh cycle -- never a dropped message.
const SEVENTV_ENABLED = (process.env.SEVENTV_ENABLED ?? 'true').toLowerCase() !== 'false';
const SEVENTV_REFRESH_MS = Math.max(Number(process.env.SEVENTV_REFRESH_MS ?? 300_000) || 300_000, 10_000);

// roomId (the channel's numeric Twitch user id) -> Map of exact code ->
// {id, name}, or null once a fetch succeeded with no set / a fetch failed
// (kept so we don't refetch on every message; the interval retries).
const seventvSets = new Map();
// roomId -> in-flight fetch promise, so concurrent first messages for a
// fresh channel only trigger one API call.
const seventvFetches = new Map();

// Kicks off the first fetch for a roomId the cache doesn't know yet. The
// message handler is synchronous, so the fetch happens in the background
// and messages queued before it resolves simply get Twitch-only emotes.
function ensureSeventvEmoteSet(roomId) {
  if (!SEVENTV_ENABLED || roomId == null || seventvSets.has(roomId)) return;
  void refreshSeventvEmoteSet(roomId);
}

async function refreshSeventvEmoteSet(roomId) {
  if (seventvFetches.has(roomId)) return seventvFetches.get(roomId);
  const fetchPromise = fetchSeventvEmoteSet(roomId)
    .then((set) => seventvSets.set(roomId, set))
    .catch((err) => {
      // fetchSeventvEmoteSet never throws, but keep the worker alive no
      // matter what; the interval will retry.
      console.error(`7TV emote set fetch failed for room ${roomId}:`, err instanceof Error ? err.message : err);
      seventvSets.set(roomId, null);
    })
    .finally(() => seventvFetches.delete(roomId));
  seventvFetches.set(roomId, fetchPromise);
  return fetchPromise;
}

async function refreshAllSeventvSets() {
  for (const roomId of [...seventvSets.keys()]) {
    await refreshSeventvEmoteSet(roomId);
  }
}

if (CHANNELS.length === 0) {
  console.error('Missing TWITCH_CHANNEL (or TWITCH_CHANNELS) in .env');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Without this listener, a network error on an idle pooled connection
// crashes the whole process (unhandled 'error' event on an EventEmitter).
pool.on('error', (err) => {
  console.error('Unexpected pg pool error:', err.message);
});

// In-memory set of lowercased usernames to never log. Merged from the
// EXCLUDED_USERNAMES env var and the excluded_users DB table, refreshed
// periodically so you can add/remove names without restarting the worker.
let excludedUsernames = new Set();

async function refreshExcludedUsernames() {
  const fromEnv = parseExcludedFromEnv(process.env.EXCLUDED_USERNAMES);
  let fromDb = [];
  try {
    const res = await pool.query('select username from excluded_users');
    fromDb = res.rows.map((r) => r.username);
  } catch (err) {
    console.error('Could not load excluded_users table:', err.message);
  }
  excludedUsernames = mergeExcludedUsernames(fromEnv, fromDb);
  console.log(`Excluded usernames loaded (${excludedUsernames.size}):`, [...excludedUsernames].join(', ') || '(none)');
}

async function upsertUser(twitchUserId, username, displayName) {
  const res = await pool.query(
    `insert into users (twitch_user_id, username, display_name)
     values ($1, $2, $3)
     on conflict (twitch_user_id)
     do update set username = excluded.username, display_name = excluded.display_name
     returning id`,
    [twitchUserId, username, displayName]
  );
  return res.rows[0].id;
}

// The `room-id` IRC tag (the channel's numeric Twitch user ID) is present
// on every PRIVMSG tmi.js delivers, so no separate roomstate lookup or
// Twitch API credentials are needed. A channel's ID never changes once
// recorded, so this in-memory set skips the insert after the first message
// per channel per process lifetime, instead of hitting the DB on every
// single chat message.
const channelsWithKnownId = new Set();

// ---------------------------------------------------------------------------
// Write batching
// ---------------------------------------------------------------------------

// Chat can arrive much faster than per-message DB round trips keep up with
// (each message would otherwise cost two round trips: a user upsert, then
// the three writes below in parallel). Instead, incoming messages are queued
// and flushed every FLUSH_INTERVAL_MS -- or once FLUSH_MAX_MESSAGES pile up
// -- as a handful of multi-row statements: one user upsert, one message
// insert, one channel-state upsert, and (rarely, once per channel) a
// channel-id insert. A channel averaging 10 msg/s drops from ~20 queries/s
// to ~3. A flush failure is logged and that batch is dropped, exactly like
// a per-message insert failure was before -- the stream keeps flowing.
const FLUSH_INTERVAL_MS = 1_500;
const FLUSH_MAX_MESSAGES = 200;

let pending = [];
let flushing = false;

function enqueueMessage(message) {
  pending.push(message);
  if (pending.length >= FLUSH_MAX_MESSAGES) void flush();
}

async function flush() {
  if (flushing) return;
  const batch = pending;
  if (batch.length === 0) return;
  pending = [];
  flushing = true;
  try {
    // Distinct users in this batch (keyed by twitch_user_id) are upserted in
    // one statement; the returned ids map back to each queued message.
    const userIdByTwitchId = new Map();
    const userRows = [];
    for (const m of batch) {
      if (m.twitchUserId == null || userIdByTwitchId.has(m.twitchUserId)) continue;
      userIdByTwitchId.set(m.twitchUserId, null);
      userRows.push(m);
    }
    if (userRows.length > 0) {
      const res = await pool.query(
        `insert into users (twitch_user_id, username, display_name)
         select * from unnest($1::text[], $2::text[], $3::text[])
         on conflict (twitch_user_id)
         do update set username = excluded.username, display_name = excluded.display_name
         returning id, twitch_user_id`,
        [userRows.map((m) => m.twitchUserId), userRows.map((m) => m.username), userRows.map((m) => m.displayName)]
      );
      for (const row of res.rows) userIdByTwitchId.set(row.twitch_user_id, row.id);
    }

    const messageUserIds = [];
    const messageChannels = [];
    const messageTexts = [];
    const messageEmotes = [];
    const stateUserIds = [];
    const stateChannels = [];
    const colors = [];
    const badges = [];
    const channelIdRows = [];

    for (const m of batch) {
      let userId = m.twitchUserId != null ? userIdByTwitchId.get(m.twitchUserId) : undefined;
      if (userId == null) {
        // Rare path: no user-id tag (tmi.js virtually always includes one).
        // Insert the user row individually, as before batching.
        userId = await upsertUser(m.twitchUserId ?? null, m.username, m.displayName);
      }
      messageUserIds.push(userId);
      messageChannels.push(m.channel);
      messageTexts.push(m.text);
      messageEmotes.push(m.emotes ? JSON.stringify(m.emotes) : null);
      stateUserIds.push(userId);
      stateChannels.push(m.channel);
      colors.push(m.color || null);
      badges.push(JSON.stringify(m.badges ?? {}));
      if (m.roomId && !channelsWithKnownId.has(m.channel)) channelIdRows.push([m.channel, m.roomId]);
    }

    await Promise.all([
      pool.query(
        `insert into messages (user_id, channel, message_text, emotes)
         select user_id, channel, message_text, emotes::jsonb
         from unnest($1::int[], $2::text[], $3::text[], $4::text[])
              as u(user_id, channel, message_text, emotes)`,
        [messageUserIds, messageChannels, messageTexts, messageEmotes]
      ),
      pool.query(
        `insert into user_channel_state (user_id, channel, color, badges, updated_at)
         select user_id, channel, color, badges::jsonb, now()
         from unnest($1::int[], $2::text[], $3::text[], $4::text[])
              as u(user_id, channel, color, badges)
         on conflict (user_id, channel)
         do update set color = excluded.color, badges = excluded.badges, updated_at = excluded.updated_at`,
        [stateUserIds, stateChannels, colors, badges]
      ),
      channelIdRows.length > 0
        ? pool.query(
            `insert into channels (channel, twitch_channel_id)
             select * from unnest($1::text[], $2::text[])
             on conflict (channel) do nothing`,
            [channelIdRows.map((r) => r[0]), channelIdRows.map((r) => r[1])]
          )
        : Promise.resolve(),
    ]);

    // The channel-id insert only succeeds once per channel per process
    // lifetime (see channelsWithKnownId below); mark them known only after
    // the insert actually succeeded.
    for (const [channel] of channelIdRows) channelsWithKnownId.add(channel);
  } catch (err) {
    console.error('Failed to flush batched chat writes:', err instanceof Error ? err.message : err);
  } finally {
    flushing = false;
  }
}

setInterval(flush, FLUSH_INTERVAL_MS);

const client = new tmi.Client({
  connection: { reconnect: true, secure: true },
  channels: CHANNELS,
});

client.on('message', (channel, tags, message, self) => {
  const username = tags.username;
  if (shouldSkipMessage({ self, message, skipCommands: SKIP_COMMANDS })) return;
  if (!username) return;

  if (isExcluded(username, excludedUsernames)) return;

  // No awaits here: writes are queued and flushed in batches (see the
  // batching section above) so per-message work stays O(1) even during chat
  // bursts. parseEmotes/parseSeventvEmotes are pure CPU and can run
  // synchronously; the 7TV set fetch happens in the background (see
  // ensureSeventvEmoteSet) and is cached per channel.
  ensureSeventvEmoteSet(tags['room-id']);
  enqueueMessage({
    twitchUserId: tags['user-id'],
    username,
    displayName: tags['display-name'] ?? username,
    channel: channel.replace('#', ''),
    color: tags.color,
    badges: tags.badges,
    text: message,
    emotes: mergeEmoteOccurrences(
      parseEmotes(tags, message),
      parseSeventvEmotes(message, seventvSets.get(tags['room-id']))
    ),
    roomId: tags['room-id'],
  });
});

client.on('connected', (addr, port) => {
  console.log(`Connected to Twitch IRC at ${addr}:${port}, watching ${CHANNELS.map((c) => `#${c}`).join(', ')}`);
});

async function main() {
  await refreshExcludedUsernames();
  setInterval(refreshExcludedUsernames, EXCLUDED_REFRESH_MS);
  if (SEVENTV_ENABLED) {
    setInterval(refreshAllSeventvSets, SEVENTV_REFRESH_MS);
    console.log(`7TV emote tracking enabled (refresh every ${SEVENTV_REFRESH_MS / 1000}s)`);
  }
  await client.connect();
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  // Drain whatever is still queued before dropping the connections, so a
  // restart doesn't lose the last couple of seconds of chat.
  await flush();
  await client.disconnect();
  await pool.end();
  process.exit(0);
});

// Last-resort safety nets: log and exit so the process manager (e.g. PM2)
// can restart cleanly, rather than crashing silently or hanging.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
