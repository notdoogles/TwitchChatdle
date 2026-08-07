import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

// .env lives at the repo root, not in this workspace, so load it explicitly
// rather than relying on dotenv/config's cwd-relative default.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
create table if not exists users (
  id serial primary key,
  twitch_user_id text unique not null,
  username text not null,
  display_name text,
  first_seen_at timestamptz not null default now()
);

-- Deprecated: these used to hold the chatter's most recently observed IRC
-- tags, but since apps/ingest can log multiple channels into this same
-- users table (TWITCH_CHANNELS), a single global snapshot is wrong for any
-- chatter active in more than one channel -- e.g. a VIP in channel A who
-- also chats in channel B would show as VIP everywhere. Superseded by
-- user_channel_state below, which scopes color/badges per (channel,
-- user). Left in place (unread) rather than dropped -- this migration is
-- additive-only.
alter table users add column if not exists color text;
alter table users add column if not exists badges jsonb;

-- Per-channel snapshot of the chatter's most recently observed IRC tags in
-- *that* channel, refreshed on every message (see apps/ingest/index.js
-- upsertChannelState). Used by apps/web's easy-mode hints (lib/game.ts):
-- color is the chatter's chat name color, badges is the raw badges tag
-- object (e.g. {"subscriber":"12","vip":"1"}), classified into global vs.
-- channel-specific hints by apps/web/lib/badges.ts. Both are null for any
-- chatter who hasn't sent a message in that channel since this table was
-- added, even if one of their older messages is picked as a round's
-- answer -- apps/web treats null as "no badge"/"default color" rather
-- than erroring.
create table if not exists user_channel_state (
  user_id integer not null references users(id),
  channel text not null,
  color text,
  badges jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, channel)
);

create table if not exists messages (
  id bigserial primary key,
  user_id integer not null references users(id),
  channel text not null,
  message_text text not null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_messages_channel on messages(channel);
create index if not exists idx_messages_user_id on messages(user_id);

-- Usernames that should never be logged, kept in the DB so you can
-- update the list without redeploying the worker. Env var EXCLUDED_USERNAMES
-- is merged with this table at runtime.
create table if not exists excluded_users (
  username text primary key,
  reason text,
  created_at timestamptz not null default now()
);

-- Owned by apps/web, not apps/ingest, but created here too so a single
-- migration sets up everything both apps need against a fresh database.
create table if not exists game_rounds (
  id uuid primary key,
  channel text not null,
  user_id integer not null references users(id),
  message_ids integer[] not null,
  guesses_used integer not null default 0,
  max_guesses integer not null default 5,
  solved boolean not null default false,
  -- Calendar day (America/New_York) this round is "today's answer" for.
  -- One row per channel per day; guess grading is stateless/per-player
  -- (tracked client-side in localStorage) so this column is what makes
  -- the daily answer the same for every player until the next midnight EST.
  game_date date,
  created_at timestamptz not null default now()
);

create index if not exists idx_game_rounds_channel on game_rounds(channel);

-- Tracks how many times a given day's round has been rerolled via the
-- admin /api/game/reroll endpoint (0 = original pick). Folded into the RNG
-- seed so a reroll deterministically produces a *different* pick than the
-- previous variant, while still being reproducible if computed twice.
alter table game_rounds add column if not exists variant integer not null default 0;

-- Autocomplete hint list for this round, captured at creation time so
-- apps/web's createRound() can serve an already-created round without
-- re-running the expensive candidate-message query on every page view.
-- NULL for rounds created before this column existed; those are backfilled
-- once, lazily, on first read (see lib/game.ts buildFromStoredRound).
alter table game_rounds add column if not exists username_hints text[];

-- Enforces "one answer per channel per day" -- apps/web's createRound()
-- does an upsert-style insert against this so concurrent first-visitors of
-- the day can't create two different daily answers.
create unique index if not exists idx_game_rounds_channel_date
  on game_rounds(channel, game_date);

-- Helps the candidate-message query in apps/web/lib/game.ts do less work as
-- the messages table grows.
create index if not exists idx_messages_channel_len
  on messages (channel)
  include (message_text);

-- Owned by apps/web. Optional request observability log for diagnosing
-- unusual traffic patterns; not required for gameplay.
create table if not exists request_log (
  id bigserial primary key,
  address text,
  path text not null,
  referrer text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_request_log_created_at on request_log(created_at);

-- Maps a channel name to its numeric Twitch user ID (the "room-id" IRC
-- tag, present on every chat message tmi.js delivers -- no Twitch API
-- credentials needed for *this* lookup). apps/web uses this to look up
-- that channel's badge set from Twitch's Helix "Get Channel Chat Badges"
-- API (api.twitch.tv/helix/chat/badges), which is keyed by numeric ID
-- rather than channel name. Never updated once set (a channel's ID
-- doesn't change), so apps/ingest just upserts on conflict do nothing.
create table if not exists channels (
  channel text primary key,
  twitch_channel_id text not null,
  updated_at timestamptz not null default now()
);
`;

async function main() {
  console.log('Running migration...');
  await pool.query(SQL);
  console.log(
    'Done. Tables ready: users, user_channel_state, messages, excluded_users, game_rounds, request_log, channels'
  );
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
