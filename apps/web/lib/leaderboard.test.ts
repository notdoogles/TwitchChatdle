import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => {
  const mockPool = { query: vi.fn() };
  return {
    pool: mockPool,
    getPool: vi.fn(() => mockPool),
  };
});

import { pool } from './db';
import { getLeaderboard, solvePoints, weekStart } from './leaderboard';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedQuery.mockReset();
  vi.unstubAllEnvs();
  // Deterministic "today" for the game-date derived windows.
  vi.stubEnv('RESET_HOUR', '0');
  vi.stubEnv('RESET_TIMEZONE', 'UTC');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const today = () => new Date().toISOString().slice(0, 10);

describe('solvePoints', () => {
  it('awards more points for fewer guesses', () => {
    expect(solvePoints(1)).toBe(5);
    expect(solvePoints(3)).toBe(3);
    expect(solvePoints(5)).toBe(1);
  });

  it('never goes negative', () => {
    expect(solvePoints(6)).toBe(0);
  });
});

describe('weekStart', () => {
  it('returns the Monday of the ISO week containing the date', () => {
    expect(weekStart('2026-08-07')).toBe('2026-08-03'); // Friday
    expect(weekStart('2026-08-09')).toBe('2026-08-03'); // Sunday
    expect(weekStart('2026-08-03')).toBe('2026-08-03'); // Monday itself
    expect(weekStart('2026-08-10')).toBe('2026-08-10'); // next Monday
  });

  it('crosses year boundaries', () => {
    expect(weekStart('2026-01-01')).toBe('2025-12-29'); // Thursday of the last 2025 week
  });
});

describe('getLeaderboard daily', () => {
  it('queries today by game_date, only solves, ordered by guesses then time', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { rank: 1, username: 'Alice', points: 4, guesses_used: 2, is_you: false },
        { rank: 2, username: 'Bob', points: 5, guesses_used: 1, is_you: true },
      ],
    });

    const data = await getLeaderboard('somechannel', 'daily', undefined, 42);

    expect(data.period).toBe('daily');
    expect(data.gameDate).toBe(today());
    expect(data.entries).toEqual([
      { rank: 1, username: 'Alice', points: 4, guessesUsed: 2, isYou: false },
      { rank: 2, username: 'Bob', points: 5, guessesUsed: 1, isYou: true },
    ]);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('gr.game_date = $2');
    expect(sql).toContain('gr.solved');
    expect(sql).toContain('row_number() over (order by gr.guesses_used asc, gr.created_at asc)');
    expect(sql).toContain('(u.id = $3) as is_you');
    expect(params).toEqual(['somechannel', today(), 42, 100]);
  });

  it('passes null viewer when the player is not signed in', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    await getLeaderboard('somechannel', 'daily');
    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['somechannel', today(), null, 100]);
  });
});

describe('getLeaderboard weekly / alltime', () => {
  it('windows weekly results to the current Monday', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { username: 'Alice', points: 9, is_you: true },
        { username: 'Bob', points: 4, is_you: false },
      ],
    });

    const data = await getLeaderboard('somechannel', 'weekly', undefined, 7);

    expect(data.entries).toEqual([
      { rank: 1, username: 'Alice', points: 9, isYou: true },
      { rank: 2, username: 'Bob', points: 4, isYou: false },
    ]);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('gr.game_date >= $2 and gr.game_date <= $3');
    expect(sql).toContain('group by u.id');
    expect(sql).toContain('having count(*) filter (where gr.solved) > 0');
    expect(params).toEqual(['somechannel', weekStart(today()), today(), 7, 100]);
  });

  it('aggregates alltime without a date filter', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ username: 'Alice', points: 42, is_you: false }] });

    await getLeaderboard('somechannel', 'alltime', undefined, null);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('game_date');
    expect(params).toEqual(['somechannel', null, 100]);
  });

  it('ranks by points, then total guesses, then earliest last solve', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    await getLeaderboard('somechannel', 'alltime');
    const [sql] = mockedQuery.mock.calls[0] as [string];
    expect(sql).toContain('order by points desc, sum(gr.guesses_used) asc, last_solved asc');
  });
});
