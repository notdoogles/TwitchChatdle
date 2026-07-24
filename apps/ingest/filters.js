// Pure logic extracted from index.js so it can be unit tested without
// connecting to Twitch or Postgres. index.js wires these into the tmi.js
// client and the DB-backed excluded_users table.

// Parses the comma-separated EXCLUDED_USERNAMES env var into a lowercased,
// deduped array of usernames. Accepts the raw string (or undefined) rather
// than reading process.env directly so it's easy to call with test input.
export function parseExcludedFromEnv(envValue) {
  return (envValue ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Merges the env-configured list with the excluded_users DB table into a
// single lowercased Set, deduping across both sources.
export function mergeExcludedUsernames(fromEnv, fromDb) {
  const lowerDb = fromDb.map((name) => name.toLowerCase());
  return new Set([...fromEnv, ...lowerDb]);
}

// Case-insensitive membership check against the merged excluded set.
export function isExcluded(username, excludedSet) {
  return excludedSet.has(username.toLowerCase());
}

// Resolves the list of channels the worker should join: TWITCH_CHANNELS
// (comma-separated) takes priority for running one worker across multiple
// streamers sharing a DB; TWITCH_CHANNEL is the single-channel default so
// existing single-streamer setups need zero config changes. Lowercased and
// deduped since Twitch channel names are case-insensitive and the
// `messages.channel` column is always written lowercase (see index.js).
export function parseChannels(channelsEnv, channelEnv) {
  const multi = (channelsEnv ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (multi.length > 0) return [...new Set(multi)];

  const single = (channelEnv ?? '').trim().toLowerCase();
  return single ? [single] : [];
}

// Decides whether an incoming chat message should be skipped before it's
// ever logged: messages the bot's own account sent (self), and, when
// skipCommands is enabled, messages starting with "!".
export function shouldSkipMessage({ self, message, skipCommands }) {
  if (self) return true;
  if (skipCommands && message.trim().startsWith('!')) return true;
  return false;
}
