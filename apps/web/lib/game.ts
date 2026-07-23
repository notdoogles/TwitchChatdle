import crypto from 'crypto';
import { pool } from './db';
import { isIntelligible } from './textFilters';
import { getGameDate, getUsernameHintsLimit } from './config';

export const MAX_GUESSES = 5;
const MIN_MESSAGES_PER_ROUND = MAX_GUESSES;

interface CandidateRow {
  id: number;
  user_id: number;
  username: string;
  message_text: string;
}

export interface NewRound {
  roundId: string;
  gameDate: string;
  message: string;
  guessesRemaining: number;
  maxGuesses: number;
  usernameHints: string[];
}

export interface GuessResult {
  correct: boolean;
  gameOver: boolean;
  guessesRemaining?: number;
  nextMessage?: string | null;
  correctUsername?: string;
  allMessages?: string[];
}

export { getGameDate };

// Deterministic PRNG (mulberry32) so the chatter/message picks for a given
// channel + calendar day are reproducible -- if two requests race to create
// the day's round they compute the same candidate before either one's
// insert wins the unique (channel, game_date) constraint.
function seedFromString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Pulls every message in the channel that is (a) globally unique after
// normalizing whitespace/case -- the R9K-style check, done here with a
// GROUP BY/COUNT rather than an external bot -- and (b) passes the
// intelligibility heuristic (see lib/textFilters.ts). Length >= 12 is
// pushed into SQL to cut down rows before the JS filter runs.
async function fetchCandidateMessages(channel: string): Promise<CandidateRow[]> {
  const { rows } = await pool.query<CandidateRow>(
    `
    with normalized as (
      select
        m.id,
        m.user_id,
        u.username,
        m.message_text,
        lower(regexp_replace(trim(m.message_text), '\\s+', ' ', 'g')) as norm_text
      from messages m
      join users u on u.id = m.user_id
      where m.channel = $1
        and length(trim(m.message_text)) >= 12
    ),
    counts as (
      select norm_text, count(*) as cnt
      from normalized
      group by norm_text
    )
    select n.id, n.user_id, n.username, n.message_text
    from normalized n
    join counts c on c.norm_text = n.norm_text
    where c.cnt = 1
    `,
    [channel]
  );

  return rows.filter((row) => isIntelligible(row.message_text));
}

export async function createRound(channel: string, host?: string | null): Promise<NewRound> {
  const gameDate = getGameDate(new Date(), host);
  const candidates = await fetchCandidateMessages(channel);
  // Kept uncapped here -- the correct answer must always be present in this
  // list for buildNewRoundFromRow to be able to guarantee it survives the
  // cap applied below.
  const allUsernames = [...new Set(candidates.map((c) => c.username))].sort();

  const existing = await pool.query(
    `select gr.id, gr.message_ids, gr.max_guesses
     from game_rounds gr
     where gr.channel = $1 and gr.game_date = $2`,
    [channel, gameDate]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return buildNewRoundFromRow(row.id, gameDate, allUsernames, row.message_ids, row.max_guesses, host);
  }

  if (candidates.length === 0) {
    throw new Error('No candidate messages yet -- let the channel chat a bit more first.');
  }

  const byUser = new Map<number, CandidateRow[]>();
  for (const row of candidates) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  const eligible = [...byUser.entries()]
    .filter(([, msgs]) => msgs.length >= MIN_MESSAGES_PER_ROUND)
    .sort((a, b) => a[0] - b[0]); // stable order so the seeded pick below is reproducible
  if (eligible.length === 0) {
    throw new Error('No chatter has enough unique, readable messages yet.');
  }

  const rng = mulberry32(seedFromString(`${channel}:${gameDate}`));
  const [userId, userMessages] = eligible[Math.floor(rng() * eligible.length)];
  const shuffled = seededShuffle(userMessages, rng);
  const chosen = shuffled.slice(0, MAX_GUESSES);

  const roundId = crypto.randomUUID();
  const inserted = await pool.query(
    `insert into game_rounds (id, channel, user_id, message_ids, max_guesses, game_date)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (channel, game_date) do nothing
     returning id, message_ids, max_guesses`,
    [roundId, channel, userId, chosen.map((c) => c.id), chosen.length, gameDate]
  );

  if (inserted.rows.length === 0) {
    // Another request won the race and already created today's round.
    const { rows } = await pool.query(
      `select id, message_ids, max_guesses from game_rounds where channel = $1 and game_date = $2`,
      [channel, gameDate]
    );
    return buildNewRoundFromRow(rows[0].id, gameDate, allUsernames, rows[0].message_ids, rows[0].max_guesses, host);
  }

  const row = inserted.rows[0];
  return buildNewRoundFromRow(row.id, gameDate, allUsernames, row.message_ids, row.max_guesses, host);
}

async function buildNewRoundFromRow(
  roundId: string,
  gameDate: string,
  allUsernames: string[],
  messageIds: number[],
  maxGuesses: number,
  host?: string | null
): Promise<NewRound> {
  const { rows } = await pool.query(
    `select m.message_text, u.username
     from messages m
     join users u on u.id = m.user_id
     where m.id = $1`,
    [messageIds[0]]
  );
  const correctUsername = rows[0]?.username;
  return {
    roundId,
    gameDate,
    message: rows[0]?.message_text ?? '',
    guessesRemaining: maxGuesses,
    maxGuesses,
    usernameHints: capUsernameHints(allUsernames, correctUsername, getUsernameHintsLimit(host)),
  };
}

// Caps the hint list to `limit` entries while guaranteeing the correct
// answer is always present in it -- otherwise a channel with more eligible
// chatters than the cap could occasionally hide the right answer from
// autocomplete entirely, which isn't the point of a "hint, not a spoiler"
// list. `correctUsername` is always expected to be a member of
// `allUsernames` since it comes from the same candidate pool.
function capUsernameHints(allUsernames: string[], correctUsername: string | undefined, limit: number): string[] {
  if (allUsernames.length <= limit) return allUsernames;
  if (!correctUsername || !allUsernames.includes(correctUsername)) return allUsernames.slice(0, limit);

  const others = allUsernames.filter((name) => name !== correctUsername).slice(0, limit - 1);
  return [...others, correctUsername].sort();
}

// Fetches message texts for a set of ids, preserving the given order.
// Queries one id at a time (same pattern as the single-message lookups
// below) rather than a batched `where id = any(...)` + JS-side remap --
// Postgres can return bigint columns as strings, which would silently
// break a Map keyed by the numeric ids from game_rounds.message_ids.
async function fetchMessagesByIds(messageIds: number[]): Promise<string[]> {
  const texts: string[] = [];
  for (const id of messageIds) {
    const { rows } = await pool.query<{ message_text: string }>(
      'select message_text from messages where id = $1',
      [id]
    );
    texts.push(rows[0]?.message_text ?? '');
  }
  return texts;
}

// Grading is stateless and per-request: the client tracks how many guesses
// it has already used (in localStorage) and passes that count in. This lets
// every player attempt the same shared daily round independently without a
// server-side "guesses used" counter that different players would stomp on.
export async function submitGuess(roundId: string, guessRaw: string, guessNumber: number): Promise<GuessResult> {
  const { rows } = await pool.query(
    `select gr.message_ids, gr.max_guesses, u.username
     from game_rounds gr
     join users u on u.id = gr.user_id
     where gr.id = $1`,
    [roundId]
  );
  if (rows.length === 0) throw new Error("Round not found -- refresh to get today's round.");
  const round = rows[0];

  if (!Number.isInteger(guessNumber) || guessNumber < 0 || guessNumber >= round.max_guesses) {
    throw new Error('Invalid guess index.');
  }

  const guess = guessRaw.trim().toLowerCase();
  const correct = guess.length > 0 && guess === round.username.toLowerCase();

  if (correct) {
    const allMessages = await fetchMessagesByIds(round.message_ids);
    return { correct: true, gameOver: true, correctUsername: round.username, allMessages };
  }

  const nextIndex = guessNumber + 1;
  const gameOver = nextIndex >= round.max_guesses;

  let nextMessage: string | null = null;
  let allMessages: string[] | undefined;
  if (!gameOver) {
    const messageIds: number[] = round.message_ids;
    const nextId = messageIds[nextIndex];
    const { rows: msgRows } = await pool.query('select message_text from messages where id = $1', [nextId]);
    nextMessage = msgRows[0]?.message_text ?? null;
  } else {
    allMessages = await fetchMessagesByIds(round.message_ids);
  }

  return {
    correct: false,
    gameOver,
    guessesRemaining: round.max_guesses - nextIndex,
    nextMessage,
    correctUsername: gameOver ? round.username : undefined,
    allMessages,
  };
}
