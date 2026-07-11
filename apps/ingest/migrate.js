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
`;

async function main() {
  console.log('Running migration...');
  await pool.query(SQL);
  console.log('Done. Tables ready: users, messages, excluded_users');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
