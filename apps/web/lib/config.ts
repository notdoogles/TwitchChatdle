// Centralizes the game's display name so it's configurable per-deployment
// instead of hardcoded for one specific streamer/channel.
export const DEFAULT_GAME_NAME = 'Chatdle';
export const DEFAULT_WINNER_MESSAGE = 'You won!';
export const DEFAULT_LOSER_MESSAGE = 'You lost!';
export const DEFAULT_USERNAME_HINTS_LIMIT = 300;

export function getGameName(): string {
  return process.env.GAME_NAME?.trim() || DEFAULT_GAME_NAME;
}

export function getWinnerMessage(): string {
  return process.env.WINNER_MESSAGE?.trim() || DEFAULT_WINNER_MESSAGE;
}

export function getLoserMessage(): string {
  return process.env.LOSER_MESSAGE?.trim() || DEFAULT_LOSER_MESSAGE;
}

// Caps the autocomplete hint list shown alongside the guess box. It's just a
// UX limit (a giant dropdown stops being a useful hint), not a performance
// constraint, so deployments for very active channels can raise it freely.
export function getUsernameHintsLimit(): number {
  const raw = process.env.USERNAME_HINTS_LIMIT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_USERNAME_HINTS_LIMIT;
  const limit = Number(raw);
  return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_USERNAME_HINTS_LIMIT;
}

// Slug used for client-side storage keys (localStorage), derived from the
// game name so different deployments don't collide in a shared browser.
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'chatdle'
  );
}

// The "game day" boundary: defaults to midnight America/New_York, but both
// the hour and timezone are configurable so a deployment can reset at a
// time that matches its own channel's schedule.
export const DEFAULT_RESET_HOUR = 0;
export const DEFAULT_RESET_TIMEZONE = 'America/New_York';

export function getResetHour(): number {
  const raw = process.env.RESET_HOUR;
  if (raw === undefined || raw.trim() === '') return DEFAULT_RESET_HOUR;
  const hour = Number(raw);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_RESET_HOUR;
}

export function getResetTimezone(): string {
  return process.env.RESET_TIMEZONE?.trim() || DEFAULT_RESET_TIMEZONE;
}

// Reads the wall-clock date/time in `timeZone` for `now`, treating those
// components as UTC. This "fake UTC" trick lets us reuse plain Date/UTC
// arithmetic (which correctly handles month/year rollover, leap years,
// etc.) to shift the wall clock by the reset hour, without needing a
// timezone library.
function localPartsAsUtcMs(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  // Some locales report midnight as hour "24" -- normalize to 0.
  const hour = parseInt(map.hour, 10) % 24;
  return Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    hour,
    parseInt(map.minute, 10),
    parseInt(map.second, 10)
  );
}

// Today's puzzle date, formatted YYYY-MM-DD, using `getResetTimezone()` and
// shifted so the calendar day rolls over at `getResetHour()` instead of
// midnight. Everyone who requests a round on the same "game day" gets the
// same answer, and it changes automatically at the configured reset time
// regardless of the visitor's own timezone.
export function getGameDate(now: Date = new Date()): string {
  const shiftedMs = localPartsAsUtcMs(now, getResetTimezone()) - getResetHour() * 3600_000;
  const shifted = new Date(shiftedMs);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Milliseconds until the next game-day rollover (the next occurrence of
// `getResetHour()` in `getResetTimezone()`), for the client-side countdown.
export function getMsUntilNextGameDate(now: Date = new Date()): number {
  const resetSeconds = getResetHour() * 3600;
  const nowMs = localPartsAsUtcMs(now, getResetTimezone());
  const secondsSinceMidnight = Math.floor((nowMs % 86_400_000) / 1000);
  const secondsSinceReset = ((secondsSinceMidnight - resetSeconds) % 86400 + 86400) % 86400;
  return Math.max(0, 86400 - secondsSinceReset) * 1000;
}
