import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GAME_NAME,
  DEFAULT_LOSER_MESSAGE,
  DEFAULT_RESET_HOUR,
  DEFAULT_RESET_TIMEZONE,
  DEFAULT_USERNAME_HINTS_LIMIT,
  DEFAULT_WINNER_MESSAGE,
  getChannel,
  getGameDate,
  getGameName,
  getImagesSlug,
  getLoserMessage,
  getMsUntilNextGameDate,
  getResetHour,
  getResetTimezone,
  getUsernameHintsLimit,
  getWinnerMessage,
  slugify,
} from './config';
import { TENANTS } from './tenants';

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const key of Object.keys(TENANTS)) delete TENANTS[key];
});

describe('getGameName / getWinnerMessage / getLoserMessage', () => {
  it('fall back to defaults when unset', () => {
    vi.stubEnv('GAME_NAME', '');
    vi.stubEnv('WINNER_MESSAGE', '');
    vi.stubEnv('LOSER_MESSAGE', '');
    expect(getGameName()).toBe(DEFAULT_GAME_NAME);
    expect(getWinnerMessage()).toBe(DEFAULT_WINNER_MESSAGE);
    expect(getLoserMessage()).toBe(DEFAULT_LOSER_MESSAGE);
  });

  it('fall back to defaults when whitespace-only', () => {
    vi.stubEnv('GAME_NAME', '   ');
    expect(getGameName()).toBe(DEFAULT_GAME_NAME);
  });

  it('use the env override when set', () => {
    vi.stubEnv('GAME_NAME', 'Streamdle');
    vi.stubEnv('WINNER_MESSAGE', 'GG!');
    vi.stubEnv('LOSER_MESSAGE', 'RIP.');
    expect(getGameName()).toBe('Streamdle');
    expect(getWinnerMessage()).toBe('GG!');
    expect(getLoserMessage()).toBe('RIP.');
  });
});

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with dashes', () => {
    expect(slugify('My Cool Game!')).toBe('my-cool-game');
  });

  it('strips leading/trailing dashes', () => {
    expect(slugify('---Foo---')).toBe('foo');
  });

  it('falls back to "chatdle" for empty/symbol-only input', () => {
    expect(slugify('')).toBe('chatdle');
    expect(slugify('!!!')).toBe('chatdle');
  });
});

describe('getResetHour', () => {
  it('defaults when unset or empty', () => {
    vi.stubEnv('RESET_HOUR', '');
    expect(getResetHour()).toBe(DEFAULT_RESET_HOUR);
  });

  it('accepts valid hours 0-23', () => {
    vi.stubEnv('RESET_HOUR', '6');
    expect(getResetHour()).toBe(6);
    vi.stubEnv('RESET_HOUR', '23');
    expect(getResetHour()).toBe(23);
  });

  it('falls back to default for out-of-range or non-integer values', () => {
    vi.stubEnv('RESET_HOUR', '24');
    expect(getResetHour()).toBe(DEFAULT_RESET_HOUR);
    vi.stubEnv('RESET_HOUR', '-1');
    expect(getResetHour()).toBe(DEFAULT_RESET_HOUR);
    vi.stubEnv('RESET_HOUR', 'not-a-number');
    expect(getResetHour()).toBe(DEFAULT_RESET_HOUR);
    vi.stubEnv('RESET_HOUR', '6.5');
    expect(getResetHour()).toBe(DEFAULT_RESET_HOUR);
  });
});

describe('getUsernameHintsLimit', () => {
  it('defaults when unset or empty', () => {
    vi.stubEnv('USERNAME_HINTS_LIMIT', '');
    expect(getUsernameHintsLimit()).toBe(DEFAULT_USERNAME_HINTS_LIMIT);
  });

  it('accepts a valid positive integer override', () => {
    vi.stubEnv('USERNAME_HINTS_LIMIT', '50');
    expect(getUsernameHintsLimit()).toBe(50);
  });

  it('falls back to default for zero, negative, or non-integer values', () => {
    vi.stubEnv('USERNAME_HINTS_LIMIT', '0');
    expect(getUsernameHintsLimit()).toBe(DEFAULT_USERNAME_HINTS_LIMIT);
    vi.stubEnv('USERNAME_HINTS_LIMIT', '-5');
    expect(getUsernameHintsLimit()).toBe(DEFAULT_USERNAME_HINTS_LIMIT);
    vi.stubEnv('USERNAME_HINTS_LIMIT', 'not-a-number');
    expect(getUsernameHintsLimit()).toBe(DEFAULT_USERNAME_HINTS_LIMIT);
  });
});

describe('getResetTimezone', () => {
  it('defaults when unset', () => {
    vi.stubEnv('RESET_TIMEZONE', '');
    expect(getResetTimezone()).toBe(DEFAULT_RESET_TIMEZONE);
  });

  it('uses the env override when set', () => {
    vi.stubEnv('RESET_TIMEZONE', 'Europe/London');
    expect(getResetTimezone()).toBe('Europe/London');
  });
});

describe('getGameDate', () => {
  it('uses the previous calendar day before the reset hour, in the target timezone', () => {
    vi.stubEnv('RESET_HOUR', '6');
    vi.stubEnv('RESET_TIMEZONE', 'America/New_York');
    // 2024-01-15 04:00 America/New_York (EST, UTC-5) is before the 6am reset,
    // so it should still count as game day 2024-01-14.
    const before = new Date('2024-01-15T09:00:00.000Z');
    expect(getGameDate(before)).toBe('2024-01-14');
  });

  it('rolls over to the next calendar day after the reset hour', () => {
    vi.stubEnv('RESET_HOUR', '6');
    vi.stubEnv('RESET_TIMEZONE', 'America/New_York');
    // 2024-01-15 07:00 America/New_York (EST, UTC-5) is after the 6am reset.
    const after = new Date('2024-01-15T12:00:00.000Z');
    expect(getGameDate(after)).toBe('2024-01-15');
  });

  it('defaults to a midnight rollover when RESET_HOUR is unset', () => {
    vi.stubEnv('RESET_HOUR', '');
    vi.stubEnv('RESET_TIMEZONE', 'UTC');
    expect(getGameDate(new Date('2024-01-01T00:00:01.000Z'))).toBe('2024-01-01');
    expect(getGameDate(new Date('2024-01-01T23:59:59.000Z'))).toBe('2024-01-01');
  });
});

describe('getMsUntilNextGameDate', () => {
  it('returns close to 24h right after the reset moment', () => {
    vi.stubEnv('RESET_HOUR', '0');
    vi.stubEnv('RESET_TIMEZONE', 'UTC');
    const justAfterReset = new Date('2024-01-01T00:00:01.000Z');
    const ms = getMsUntilNextGameDate(justAfterReset);
    expect(ms).toBeGreaterThan(23 * 3600_000);
    expect(ms).toBeLessThanOrEqual(24 * 3600_000);
  });

  it('returns close to 0 right before the reset moment', () => {
    vi.stubEnv('RESET_HOUR', '0');
    vi.stubEnv('RESET_TIMEZONE', 'UTC');
    const justBeforeReset = new Date('2024-01-01T23:59:59.000Z');
    const ms = getMsUntilNextGameDate(justBeforeReset);
    expect(ms).toBeLessThanOrEqual(1000);
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('accounts for a non-midnight reset hour', () => {
    vi.stubEnv('RESET_HOUR', '6');
    vi.stubEnv('RESET_TIMEZONE', 'UTC');
    const justAfterSixAmReset = new Date('2024-01-01T06:00:01.000Z');
    const ms = getMsUntilNextGameDate(justAfterSixAmReset);
    expect(ms).toBeGreaterThan(23 * 3600_000);
    expect(ms).toBeLessThanOrEqual(24 * 3600_000);
  });
});

describe('multi-tenant overrides (lib/tenants.ts)', () => {
  const HOST = 'streamer1.example.com:443';
  const HOSTNAME = 'streamer1.example.com';

  it('a tenant override takes priority over the matching env var', () => {
    vi.stubEnv('GAME_NAME', 'EnvName');
    vi.stubEnv('TWITCH_CHANNEL', 'env-channel');
    TENANTS[HOSTNAME] = { gameName: 'TenantName', channel: 'tenant-channel' };
    expect(getGameName(HOST)).toBe('TenantName');
    expect(getChannel(HOST)).toBe('tenant-channel');
  });

  it('falls back to the env var / default when no tenant matches the host', () => {
    vi.stubEnv('GAME_NAME', 'EnvName');
    TENANTS[HOSTNAME] = { gameName: 'TenantName' };
    expect(getGameName('unrelated-host.com')).toBe('EnvName');
    expect(getGameName(undefined)).toBe('EnvName');
  });

  it('falls back through env var to the default when neither is set', () => {
    expect(getChannel(HOST)).toBeUndefined();
    expect(getImagesSlug(HOST)).toBeUndefined();
  });

  it('applies tenant overrides for reset hour/timezone and username hints limit', () => {
    vi.stubEnv('RESET_HOUR', '0');
    vi.stubEnv('RESET_TIMEZONE', 'UTC');
    vi.stubEnv('USERNAME_HINTS_LIMIT', '50');
    TENANTS[HOSTNAME] = { resetHour: 9, resetTimezone: 'Europe/London', usernameHintsLimit: 10 };
    expect(getResetHour(HOST)).toBe(9);
    expect(getResetTimezone(HOST)).toBe('Europe/London');
    expect(getUsernameHintsLimit(HOST)).toBe(10);
  });

  it('resolves getImagesSlug from a tenant override', () => {
    TENANTS[HOSTNAME] = { imagesSlug: 'streamer1' };
    expect(getImagesSlug(HOST)).toBe('streamer1');
  });
});
