-- Run this once against the same Supabase Postgres database the ingest
-- worker writes to (it assumes `users` and `messages` already exist).

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

-- Enforces "one answer per channel per day" -- createRound() does an
-- upsert-style insert against this so concurrent first-visitors of the day
-- can't create two different daily answers.
create unique index if not exists idx_game_rounds_channel_date
  on game_rounds(channel, game_date);

-- Helps the candidate-message query in lib/game.ts do less work as the
-- messages table grows.
create index if not exists idx_messages_channel_len
  on messages (channel)
  include (message_text);
