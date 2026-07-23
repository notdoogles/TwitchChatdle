import 'dotenv/config';
import pg from 'pg';

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
`;

async function main() {
  console.log('Running migration...');
  await pool.query(SQL);
  console.log('Done. Tables ready: users, messages, excluded_users, game_rounds');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
