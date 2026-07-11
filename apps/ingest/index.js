import 'dotenv/config';
import tmi from 'tmi.js';
import pg from 'pg';
import { isExcluded, mergeExcludedUsernames, parseExcludedFromEnv, shouldSkipMessage } from './filters.js';

const { Pool } = pg;

const CHANNEL = process.env.TWITCH_CHANNEL;
const SKIP_COMMANDS = (process.env.SKIP_COMMANDS ?? 'true').toLowerCase() === 'true';
const EXCLUDED_REFRESH_MS = 60_000;

if (!CHANNEL) {
  console.error('Missing TWITCH_CHANNEL in .env');
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

async function insertMessage(userId, channel, text) {
  await pool.query(
    `insert into messages (user_id, channel, message_text) values ($1, $2, $3)`,
    [userId, channel, text]
  );
}

const client = new tmi.Client({
  connection: { reconnect: true, secure: true },
  channels: [CHANNEL],
});

client.on('message', async (channel, tags, message, self) => {
  const username = tags.username;
  if (shouldSkipMessage({ self, message, skipCommands: SKIP_COMMANDS })) return;
  if (!username) return;

  if (isExcluded(username, excludedUsernames)) return;

  try {
    const userId = await upsertUser(tags['user-id'], username, tags['display-name'] ?? username);
    await insertMessage(userId, channel.replace('#', ''), message);
  } catch (err) {
    console.error('Failed to log message:', err.message);
  }
});

client.on('connected', (addr, port) => {
  console.log(`Connected to Twitch IRC at ${addr}:${port}, watching #${CHANNEL}`);
});

async function main() {
  await refreshExcludedUsernames();
  setInterval(refreshExcludedUsernames, EXCLUDED_REFRESH_MS);
  await client.connect();
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await client.disconnect();
  await pool.end();
  process.exit(0);
});
