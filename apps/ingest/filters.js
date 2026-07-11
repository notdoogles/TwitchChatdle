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

// Decides whether an incoming chat message should be skipped before it's
// ever logged: messages the bot's own account sent (self), and, when
// skipCommands is enabled, messages starting with "!".
export function shouldSkipMessage({ self, message, skipCommands }) {
  if (self) return true;
  if (skipCommands && message.trim().startsWith('!')) return true;
  return false;
}
