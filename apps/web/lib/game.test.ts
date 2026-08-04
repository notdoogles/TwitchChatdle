import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from './db';
import { createRound, rerollRound, skipMessage, submitGuess } from './game';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

// resolveBadgeImageUrl (lib/badgeImages.ts) calls global fetch to hit
// Twitch's Badges API; stub it out so submitGuess tests stay hermetic
// (no real network calls) and always fall back to a null icon.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: false }))
);

interface CandidateRow {
  id: number;
  user_id: number;
  username: string;
  message_text: string;
}

interface GameRoundRow {
  id: string;
  message_ids: number[];
  max_guesses: number;
}

// A message long/varied enough to pass lib/textFilters.isIntelligible.
function msg(text: string): string {
  return text;
}

function candidatesForUser(userId: number, username: string, count: number): CandidateRow[] {
  const pool: CandidateRow[] = [];
  for (let i = 0; i < count; i++) {
    pool.push({
      id: userId * 100 + i,
      user_id: userId,
      username,
      message_text: msg(`this is unique chat message number ${i} from ${username}`),
    });
  }
  return pool;
}

function messageMapFrom(rows: CandidateRow[]): Map<number, string> {
  return new Map(rows.map((r) => [r.id, r.message_text]));
}

function setupCreateRoundMocks(
  candidateRows: CandidateRow[],
  {
    existingRoundRows = [] as GameRoundRow[],
    raceFallbackRows = [] as GameRoundRow[],
  } = {}
) {
  const messagesById = messageMapFrom(candidateRows);
  const usernamesById = new Map(candidateRows.map((r) => [r.id, r.username]));
  mockedQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('with normalized as')) {
      return { rows: candidateRows };
    }
    if (sql.includes('from game_rounds gr') && sql.includes('where gr.channel = $1')) {
      return { rows: existingRoundRows };
    }
    if (sql.includes('insert into game_rounds')) {
      const [id, , , messageIds, maxGuesses] = params as [string, string, number, number[], number];
      if (raceFallbackRows.length > 0) {
        // Simulate another request winning the unique-constraint race.
        return { rows: [] };
      }
      return { rows: [{ id, message_ids: messageIds, max_guesses: maxGuesses }] };
    }
    if (sql.includes('select id, message_ids, max_guesses from game_rounds where channel')) {
      return { rows: raceFallbackRows };
    }
    if (sql.includes('from messages m') && sql.includes('join users u')) {
      const id = params[0] as number;
      return { rows: [{ message_text: messagesById.get(id) ?? null, username: usernamesById.get(id) ?? null }] };
    }
    throw new Error(`Unexpected query in createRound test: ${sql}`);
  });
}

function setupRerollRoundMocks(candidateRows: CandidateRow[], { existingVariant }: { existingVariant?: number } = {}) {
  const messagesById = messageMapFrom(candidateRows);
  const usernamesById = new Map(candidateRows.map((r) => [r.id, r.username]));
  mockedQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('with normalized as')) {
      return { rows: candidateRows };
    }
    if (sql.trim().startsWith('select variant from game_rounds')) {
      return { rows: existingVariant === undefined ? [] : [{ variant: existingVariant }] };
    }
    if (sql.includes('insert into game_rounds') && sql.includes('on conflict (channel, game_date) do update')) {
      const [id, , , messageIds, maxGuesses] = params as [string, string, number, number[], number];
      return { rows: [{ id, message_ids: messageIds, max_guesses: maxGuesses }] };
    }
    if (sql.includes('from messages m') && sql.includes('join users u')) {
      const id = params[0] as number;
      return { rows: [{ message_text: messagesById.get(id) ?? null, username: usernamesById.get(id) ?? null }] };
    }
    throw new Error(`Unexpected query in rerollRound test: ${sql}`);
  });
}

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('createRound', () => {
  it('throws when there are no candidate messages yet', async () => {
    setupCreateRoundMocks([]);
    await expect(createRound('somechannel')).rejects.toThrow(/No candidate messages/);
  });

  it('throws when no chatter has enough eligible messages', async () => {
    setupCreateRoundMocks(candidatesForUser(1, 'alice', 3));
    await expect(createRound('somechannel')).rejects.toThrow(/enough unique, readable messages/);
  });

  it('only picks a chatter with at least 5 eligible messages, and returns that many', async () => {
    const rows = [...candidatesForUser(1, 'alice', 3), ...candidatesForUser(2, 'bob', 5)];
    setupCreateRoundMocks(rows);
    const round = await createRound('somechannel');
    expect(round.maxGuesses).toBe(5);
    expect(round.guessesRemaining).toBe(5);
    expect(round.message).toMatch(/from bob/);
    // alice has only 3 eligible messages (< 5), so she's excluded from the
    // hint list too, not just from being pickable as the answer.
    expect(round.usernameHints).toEqual(['bob']);
  });

  it('is deterministic for the same channel and game day', async () => {
    const rows = [...candidatesForUser(1, 'alice', 5), ...candidatesForUser(2, 'bob', 5)];
    setupCreateRoundMocks(rows);
    const roundA = await createRound('somechannel');
    setupCreateRoundMocks(rows);
    const roundB = await createRound('somechannel');
    expect(roundA.message).toBe(roundB.message);
  });

  it('returns the existing round instead of creating a new one on a second call the same day', async () => {
    const rows = candidatesForUser(1, 'alice', 5);
    setupCreateRoundMocks(rows, {
      existingRoundRows: [{ id: 'existing-round-id', message_ids: [100], max_guesses: 5 }],
    });
    const round = await createRound('somechannel');
    expect(round.roundId).toBe('existing-round-id');
    expect(round.message).toBe('this is unique chat message number 0 from alice');
  });

  it('keeps the answer in usernameHints for an existing round even if they later drop out of the live eligible pool', async () => {
    // alice was eligible (5 messages) when the round was created, but a
    // duplicate posted since then makes the candidate query re-run with
    // only 4 of her messages still unique -- simulating pool drift after
    // the round already locked in her message_ids as the answer.
    const rows = [...candidatesForUser(1, 'alice', 4), ...candidatesForUser(2, 'bob', 5)];
    setupCreateRoundMocks(rows, {
      existingRoundRows: [{ id: 'existing-round-id', message_ids: [100], max_guesses: 5 }],
    });
    const round = await createRound('somechannel');
    expect(round.message).toBe('this is unique chat message number 0 from alice');
    expect(round.usernameHints).toContain('alice');
  });

  it('falls back to the winning row when the insert loses an insert race', async () => {
    const rows = candidatesForUser(1, 'alice', 5);
    setupCreateRoundMocks(rows, {
      raceFallbackRows: [{ id: 'winner-round-id', message_ids: [100], max_guesses: 5 }],
    });
    const round = await createRound('somechannel');
    expect(round.roundId).toBe('winner-round-id');
  });

  it('respects a custom USERNAME_HINTS_LIMIT', async () => {
    vi.stubEnv('USERNAME_HINTS_LIMIT', '3');
    const rows = [
      ...candidatesForUser(1, 'alice', 5),
      ...candidatesForUser(2, 'bob', 5),
      ...candidatesForUser(3, 'carol', 5),
      ...candidatesForUser(4, 'dave', 5),
      ...candidatesForUser(5, 'erin', 5),
    ];
    setupCreateRoundMocks(rows);
    const round = await createRound('somechannel');
    expect(round.usernameHints).toHaveLength(3);
    vi.unstubAllEnvs();
  });

  it('guarantees the correct answer is included even when the hint list is capped below the total chatter count', async () => {
    vi.stubEnv('USERNAME_HINTS_LIMIT', '3');
    // All five chatters are eligible (>= 5 messages each), so whichever one
    // the seeded pick lands on, alice/carol/dave/erin sorting before it
    // shouldn't be able to push it out of a naive slice(0, 3).
    const rows = [
      ...candidatesForUser(1, 'alice', 5),
      ...candidatesForUser(2, 'bob', 5),
      ...candidatesForUser(3, 'carol', 5),
      ...candidatesForUser(4, 'dave', 5),
      ...candidatesForUser(5, 'erin', 5),
    ];
    setupCreateRoundMocks(rows);
    const round = await createRound('somechannel');
    const correctUsername = round.message.split(' from ')[1];
    expect(round.usernameHints).toContain(correctUsername);
    expect(round.usernameHints).toHaveLength(3);
    vi.unstubAllEnvs();
  });

  it('excludes chatters without enough eligible messages from the hint list', async () => {
    const rows = [...candidatesForUser(1, 'alice', 1), ...candidatesForUser(2, 'bob', 5)];
    setupCreateRoundMocks(rows);
    const round = await createRound('somechannel');
    expect(round.usernameHints).toEqual(['bob']);
  });

  it('excludes chatters cut by TOP_CHATTERS_LIMIT from the hint list', async () => {
    vi.stubEnv('TOP_CHATTERS_LIMIT', '1');
    const rows = [...candidatesForUser(1, 'alice', 8), ...candidatesForUser(2, 'bob', 5)];
    setupCreateRoundMocks(rows);
    const round = await createRound('somechannel');
    expect(round.usernameHints).toEqual(['alice']);
    vi.unstubAllEnvs();
  });

  it('restricts the answer to the top N chatters by eligible message count when TOP_CHATTERS_LIMIT is set', async () => {
    vi.stubEnv('TOP_CHATTERS_LIMIT', '1');
    // alice has more eligible messages than bob, so with a cap of 1 only
    // alice should ever be pickable as the answer.
    const rows = [...candidatesForUser(1, 'alice', 8), ...candidatesForUser(2, 'bob', 5)];
    setupCreateRoundMocks(rows);
    const round = await createRound('somechannel');
    expect(round.message).toMatch(/from alice/);
    vi.unstubAllEnvs();
  });

  it('does not restrict the answer pool when TOP_CHATTERS_LIMIT is unset', async () => {
    const rows = [...candidatesForUser(1, 'alice', 8), ...candidatesForUser(2, 'bob', 5)];
    setupCreateRoundMocks(rows);
    const round = await createRound('somechannel');
    expect(round.usernameHints).toEqual(['alice', 'bob']);
  });
});

describe('rerollRound', () => {
  it('produces the same pick as the original variant-0 seed when no round exists yet', async () => {
    const rows = [...candidatesForUser(1, 'alice', 5), ...candidatesForUser(2, 'bob', 5)];
    setupCreateRoundMocks(rows);
    const original = await createRound('somechannel');

    setupRerollRoundMocks(rows);
    const rerolled = await rerollRound('somechannel');
    expect(rerolled.message).toBe(original.message);
  });

  it('is deterministic for the same stored variant', async () => {
    const rows = [...candidatesForUser(1, 'alice', 5), ...candidatesForUser(2, 'bob', 5)];
    setupRerollRoundMocks(rows, { existingVariant: 2 });
    const a = await rerollRound('somechannel');
    setupRerollRoundMocks(rows, { existingVariant: 2 });
    const b = await rerollRound('somechannel');
    expect(a.message).toBe(b.message);
  });

  it('increments the variant stored on the existing round', async () => {
    const rows = [...candidatesForUser(1, 'alice', 5), ...candidatesForUser(2, 'bob', 5)];
    setupRerollRoundMocks(rows, { existingVariant: 2 });
    await rerollRound('somechannel');
    const insertCall = mockedQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('on conflict (channel, game_date) do update')
    );
    expect((insertCall?.[1] as unknown[])?.[6]).toBe(3);
  });

  it('throws when no chatter has enough eligible messages', async () => {
    setupRerollRoundMocks(candidatesForUser(1, 'alice', 3));
    await expect(rerollRound('somechannel')).rejects.toThrow(/enough unique, readable messages/);
  });
});

function setupSubmitGuessMocks(round: {
  message_ids: number[];
  max_guesses: number;
  username: string;
  color?: string | null;
  badges?: Record<string, string> | null;
} | null, messagesById: Map<number, string>) {
  mockedQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('join users u')) {
      return { rows: round ? [round] : [] };
    }
    if (sql.trim() === 'select message_text from messages where id = $1') {
      const id = params[0] as number;
      return { rows: [{ message_text: messagesById.get(id) ?? null }] };
    }
    throw new Error(`Unexpected query in submitGuess test: ${sql}`);
  });
}

describe('submitGuess', () => {
  const messageIds = [1, 2, 3, 4, 5];
  const messagesById = new Map(messageIds.map((id) => [id, `message #${id}`]));
  const round = {
    message_ids: messageIds,
    max_guesses: 5,
    username: 'Alice',
    color: '#FF0000',
    badges: { moderator: '1', premium: '1' },
  };

  it('throws for an unknown roundId', async () => {
    setupSubmitGuessMocks(null, messagesById);
    await expect(submitGuess('missing-round', 'alice', 0)).rejects.toThrow(/Round not found/);
  });

  it('rejects an out-of-range guessNumber', async () => {
    setupSubmitGuessMocks(round, messagesById);
    await expect(submitGuess('round-1', 'alice', 5)).rejects.toThrow(/Invalid guess index/);
    await expect(submitGuess('round-1', 'alice', -1)).rejects.toThrow(/Invalid guess index/);
  });

  it('matches the correct username case-insensitively and trims whitespace', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await submitGuess('round-1', '  ALICE  ', 0);
    expect(result.correct).toBe(true);
    expect(result.gameOver).toBe(true);
    expect(result.correctUsername).toBe('Alice');
    expect(result.allMessages).toEqual(messageIds.map((id) => `message #${id}`));
    expect(result.hint).toBeUndefined();
    expect(result.answerHint).toEqual({
      globalBadges: [{ label: 'Prime', iconUrl: null }],
      color: '#FF0000',
      channelBadges: [{ label: 'Moderator', iconUrl: null }],
    });
  });

  it('reveals the next message and decrements guesses remaining on a wrong guess', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await submitGuess('round-1', 'bob', 0);
    expect(result.correct).toBe(false);
    expect(result.gameOver).toBe(false);
    expect(result.guessesRemaining).toBe(4);
    expect(result.nextMessage).toBe('message #2');
    expect(result.allMessages).toBeUndefined();
  });

  it('attaches the global badge hint when advancing to round 2', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await submitGuess('round-1', 'bob', 0);
    expect(result.hint).toEqual({ globalBadges: [{ label: 'Prime', iconUrl: null }] });
  });

  it('attaches the color hint when advancing to round 3', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await submitGuess('round-1', 'bob', 1);
    expect(result.hint).toEqual({ color: '#FF0000' });
  });

  it('attaches the channel badge hint when advancing to round 4', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await submitGuess('round-1', 'bob', 2);
    expect(result.hint).toEqual({ channelBadges: [{ label: 'Moderator', iconUrl: null }] });
  });

  it('attaches the username length hint when advancing to round 5', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await submitGuess('round-1', 'bob', 3);
    expect(result.hint).toEqual({ usernameLength: 5 });
  });

  it('falls back to empty badge lists / null color hints for a chatter with no captured data yet', async () => {
    setupSubmitGuessMocks({ ...round, color: null, badges: null }, messagesById);
    const globalHint = await submitGuess('round-1', 'bob', 0);
    expect(globalHint.hint).toEqual({ globalBadges: [] });
    setupSubmitGuessMocks({ ...round, color: null, badges: null }, messagesById);
    const colorHint = await submitGuess('round-1', 'bob', 1);
    expect(colorHint.hint).toEqual({ color: null });
  });

  it('does not attach a hint once the game is over', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await submitGuess('round-1', 'bob', 4);
    expect(result.hint).toBeUndefined();
  });

  it('ends the game and reveals all messages once guesses are exhausted', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await submitGuess('round-1', 'bob', 4);
    expect(result.correct).toBe(false);
    expect(result.gameOver).toBe(true);
    expect(result.correctUsername).toBe('Alice');
    expect(result.allMessages).toEqual(messageIds.map((id) => `message #${id}`));
    expect(result.nextMessage).toBeNull();
    expect(result.answerHint).toEqual({
      globalBadges: [{ label: 'Prime', iconUrl: null }],
      color: '#FF0000',
      channelBadges: [{ label: 'Moderator', iconUrl: null }],
    });
  });
});

describe('skipMessage', () => {
  const messageIds = [1, 2, 3, 4, 5];
  const messagesById = new Map(messageIds.map((id) => [id, `message #${id}`]));
  const round = {
    message_ids: messageIds,
    max_guesses: 5,
    username: 'Alice',
    color: '#FF0000',
    badges: { moderator: '1', premium: '1' },
  };

  it('throws for an unknown roundId', async () => {
    setupSubmitGuessMocks(null, messagesById);
    await expect(skipMessage('missing-round', 0)).rejects.toThrow(/Round not found/);
  });

  it('rejects an out-of-range guessNumber', async () => {
    setupSubmitGuessMocks(round, messagesById);
    await expect(skipMessage('round-1', 5)).rejects.toThrow(/Invalid guess index/);
    await expect(skipMessage('round-1', -1)).rejects.toThrow(/Invalid guess index/);
  });

  it('advances to the next message, consumes a guess, and reveals the same hint a wrong guess would', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await skipMessage('round-1', 0);
    expect(result.correct).toBe(false);
    expect(result.gameOver).toBe(false);
    expect(result.guessesRemaining).toBe(4);
    expect(result.nextMessage).toBe('message #2');
    expect(result.allMessages).toBeUndefined();
    // A skip counts like a wrong guess: it unlocks the easy-mode hint the
    // next round would normally reveal.
    expect(result.hint).toEqual({ globalBadges: [{ label: 'Prime', iconUrl: null }] });
  });

  it('reveals the cumulative easy-mode hint at the same rounds as a wrong guess', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const roundThree = await skipMessage('round-1', 1);
    expect(roundThree.hint).toEqual({ color: '#FF0000' });
    const roundFour = await skipMessage('round-1', 2);
    expect(roundFour.hint).toEqual({ channelBadges: [{ label: 'Moderator', iconUrl: null }] });
  });

  it('ends the game as a loss when skipping the last message, revealing the answer with no easy-mode hint (same as a wrong guess at game over)', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await skipMessage('round-1', 4);
    expect(result.correct).toBe(false);
    expect(result.gameOver).toBe(true);
    expect(result.correctUsername).toBe('Alice');
    expect(result.allMessages).toEqual(messageIds.map((id) => `message #${id}`));
    expect(result.nextMessage).toBeNull();
    expect(result.hint).toBeUndefined();
    expect(result.answerHint).toEqual({
      globalBadges: [{ label: 'Prime', iconUrl: null }],
      color: '#FF0000',
      channelBadges: [{ label: 'Moderator', iconUrl: null }],
    });
  });
});
