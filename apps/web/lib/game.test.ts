import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from './db';
import { createRound, submitGuess } from './game';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

interface CandidateRow {
  id: number;
  user_id: number;
  username: string;
  message_text: string;
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
    existingRoundRows = [] as any[],
    raceFallbackRows = [] as any[],
  } = {}
) {
  const messagesById = messageMapFrom(candidateRows);
  const usernamesById = new Map(candidateRows.map((r) => [r.id, r.username]));
  mockedQuery.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.includes('with normalized as')) {
      return { rows: candidateRows };
    }
    if (sql.includes('from game_rounds gr') && sql.includes('where gr.channel = $1')) {
      return { rows: existingRoundRows };
    }
    if (sql.includes('insert into game_rounds')) {
      const [id, , , messageIds, maxGuesses] = params;
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
      const id = params[0];
      return { rows: [{ message_text: messagesById.get(id) ?? null, username: usernamesById.get(id) ?? null }] };
    }
    throw new Error(`Unexpected query in createRound test: ${sql}`);
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
    expect(round.usernameHints).toEqual(['alice', 'bob']);
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
      ...candidatesForUser(1, 'alice', 1),
      ...candidatesForUser(2, 'bob', 5),
      ...candidatesForUser(3, 'carol', 1),
      ...candidatesForUser(4, 'dave', 1),
      ...candidatesForUser(5, 'erin', 1),
    ];
    setupCreateRoundMocks(rows);
    const round = await createRound('somechannel');
    expect(round.usernameHints).toHaveLength(3);
    vi.unstubAllEnvs();
  });

  it('guarantees the correct answer is included even when the hint list is capped below the total chatter count', async () => {
    vi.stubEnv('USERNAME_HINTS_LIMIT', '3');
    // Only "bob" has enough messages to be picked as the answer, but the
    // uncapped username list has 5 entries -- alice/carol/dave/erin sort
    // before bob, so a naive slice(0, 3) would exclude the correct answer.
    const rows = [
      ...candidatesForUser(1, 'alice', 1),
      ...candidatesForUser(2, 'bob', 5),
      ...candidatesForUser(3, 'carol', 1),
      ...candidatesForUser(4, 'dave', 1),
      ...candidatesForUser(5, 'erin', 1),
    ];
    setupCreateRoundMocks(rows);
    const round = await createRound('somechannel');
    expect(round.usernameHints).toContain('bob');
    expect(round.usernameHints).toHaveLength(3);
    vi.unstubAllEnvs();
  });
});

function setupSubmitGuessMocks(round: {
  message_ids: number[];
  max_guesses: number;
  username: string;
} | null, messagesById: Map<number, string>) {
  mockedQuery.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.includes('join users u')) {
      return { rows: round ? [round] : [] };
    }
    if (sql.trim() === 'select message_text from messages where id = $1') {
      const id = params[0];
      return { rows: [{ message_text: messagesById.get(id) ?? null }] };
    }
    throw new Error(`Unexpected query in submitGuess test: ${sql}`);
  });
}

describe('submitGuess', () => {
  const messageIds = [1, 2, 3, 4, 5];
  const messagesById = new Map(messageIds.map((id) => [id, `message #${id}`]));
  const round = { message_ids: messageIds, max_guesses: 5, username: 'Alice' };

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

  it('ends the game and reveals all messages once guesses are exhausted', async () => {
    setupSubmitGuessMocks(round, messagesById);
    const result = await submitGuess('round-1', 'bob', 4);
    expect(result.correct).toBe(false);
    expect(result.gameOver).toBe(true);
    expect(result.correctUsername).toBe('Alice');
    expect(result.allMessages).toEqual(messageIds.map((id) => `message #${id}`));
    expect(result.nextMessage).toBeNull();
  });
});
