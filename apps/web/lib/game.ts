import crypto from 'crypto';
import { getPool } from './db';
import { isIntelligible } from './textFilters';
import { classifyAllBadges, ClassifiedBadgeSlug } from './badges';
import { resolveBadgeImageUrl } from './badgeImages';
import { BadgeHint, RoundHint } from './hints';
import {
  getGameDate,
  getMaxMessageLength,
  getMaxMessageWords,
  getTopChattersLimit,
  getUsernameHintsLimit,
} from './config';

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
  // Easy-mode hint unlocked alongside this guess's nextMessage (see
  // buildHintForRound below). Present regardless of the player's
  // easy/hard preference -- that's a client-only rendering choice, same
  // trust boundary as nextMessage itself being revealed ahead of any
  // server-side mode enforcement.
  hint?: RoundHint;
  // The chatter's full color/badge info, sent once the round ends (win or
  // loss) regardless of how many easy-mode hints were actually unlocked
  // along the way, so the final reveal screen can show the real chatter's
  // color and badges even if the player won before those hints appeared.
  answerHint?: RoundHint;
}

// Resolves every classified badge in a category to its display badge
// (label + real image, when one is available) -- unlike the old
// single-representative-badge design, every badge a chatter has in this
// IRC-tag category is now shown.
async function resolveBadgeHints(
  items: ClassifiedBadgeSlug[],
  kind: 'channel' | 'global',
  channel: string,
  host?: string | null
): Promise<BadgeHint[]> {
  return Promise.all(
    items.map(async (item) => ({
      label: item.label,
      iconUrl: await resolveBadgeImageUrl(kind, item.slug, item.version, channel, host),
    }))
  );
}

// Cumulative hint unlocked when advancing to `roundIndex` (0-based, so
// roundIndex 1 = "round 2"): round 1 has no hint, round 2 reveals the
// chatter's global Twitch badges, round 3 their chat color, round 4 their
// channel-specific badges, round 5 their username length.
async function buildHintForRound(
  roundIndex: number,
  username: string,
  color: string | null,
  badges: unknown,
  channel: string,
  host?: string | null
): Promise<RoundHint | undefined> {
  const classified = await classifyAllBadges(badges as Record<string, string> | null, channel, host);
  switch (roundIndex) {
    case 1: {
      const globalBadges = await resolveBadgeHints(classified.globalBadges, 'global', channel, host);
      return { globalBadges };
    }
    case 2:
      return { color: color || null };
    case 3: {
      const channelBadges = await resolveBadgeHints(classified.channelBadges, 'channel', channel, host);
      return { channelBadges };
    }
    case 4:
      return { usernameLength: username.length };
    default:
      return undefined;
  }
}

// Full color/badge reveal shown once a round ends (win or loss), regardless
// of which easy-mode hints were actually unlocked along the way -- see
// GuessResult.answerHint's doc comment above.
async function buildAnswerHint(
  badges: unknown,
  color: string | null,
  channel: string,
  host?: string | null
): Promise<RoundHint> {
  const classified = await classifyAllBadges(badges as Record<string, string> | null, channel, host);
  const [globalBadges, channelBadges] = await Promise.all([
    resolveBadgeHints(classified.globalBadges, 'global', channel, host),
    resolveBadgeHints(classified.channelBadges, 'channel', channel, host),
  ]);
  return {
    globalBadges,
    color: color || null,
    channelBadges,
  };
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
async function fetchCandidateMessages(channel: string, host?: string | null): Promise<CandidateRow[]> {
  const { rows } = await getPool(host).query<CandidateRow>(
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

  const maxLength = getMaxMessageLength(host);
  const maxTokens = getMaxMessageWords(host);
  return rows.filter((row) => isIntelligible(row.message_text, { maxLength, maxTokens }));
}

export async function createRound(channel: string, host?: string | null): Promise<NewRound> {
  const gameDate = getGameDate(new Date(), host);

  // Cheap path first: today's round already exists (the common case -- it's
  // created once per channel per day, then served to every visitor), so the
  // candidate-message query below only runs when there's no round yet, or to
  // lazily backfill a pre-username_hints row.
  const existing = await getPool(host).query<StoredRoundRow>(
    `select gr.id, gr.message_ids, gr.max_guesses, gr.username_hints
     from game_rounds gr
     where gr.channel = $1 and gr.game_date = $2`,
    [channel, gameDate]
  );
  if (existing.rows.length > 0) {
    return buildFromStoredRound(channel, gameDate, existing.rows[0], host);
  }

  const candidates = await fetchCandidateMessages(channel, host);
  const eligible = computeEligibleChatters(candidates, host);
  // Hints are built from the same eligible (min-messages + top-chatters-limit
  // capped) pool the answer is picked from -- see computeEligibleChatters --
  // so the hint list never includes a chatter who could never be the answer,
  // and never omits one who could.
  const allUsernames = eligible.map(([, msgs]) => msgs[0].username).sort();

  const { userId, chosen } = pickRoundCandidate(eligible, roundSeed(channel, gameDate, 0));
  // All of a round's messages come from one chatter, so the first picked
  // message's username is the answer; captured here (rather than from a
  // follow-up query) so the hint list can be written at insert time.
  const correctUsername = chosen[0]?.username;
  const usernameHints = capUsernameHints(allUsernames, correctUsername, getUsernameHintsLimit(host));

  const roundId = crypto.randomUUID();
  const inserted = await getPool(host).query(
    `insert into game_rounds (id, channel, user_id, message_ids, max_guesses, game_date, variant, username_hints)
     values ($1, $2, $3, $4, $5, $6, 0, $7)
     on conflict (channel, game_date) do nothing
     returning id, message_ids, max_guesses`,
    [roundId, channel, userId, chosen.map((c) => c.id), chosen.length, gameDate, usernameHints]
  );

  if (inserted.rows.length === 0) {
    // Another request won the race and already created today's round.
    const { rows } = await getPool(host).query<StoredRoundRow>(
      `select id, message_ids, max_guesses, username_hints from game_rounds where channel = $1 and game_date = $2`,
      [channel, gameDate]
    );
    return buildFromStoredRound(channel, gameDate, rows[0], host);
  }

  const row = inserted.rows[0];
  return buildNewRoundFromRow(row.id, gameDate, usernameHints, row.message_ids, row.max_guesses, host);
}

// Admin-only: forces today's round to a different pick than whatever is
// currently stored (or than the original pick, if nothing was stored yet),
// by bumping the per-day `variant` counter that's folded into the RNG seed.
// Guarded by ADMIN_SECRET at the route layer (see app/api/game/reroll),
// not here -- this function assumes the caller has already authorized.
export async function rerollRound(channel: string, host?: string | null): Promise<NewRound> {
  const gameDate = getGameDate(new Date(), host);
  const candidates = await fetchCandidateMessages(channel, host);
  const eligible = computeEligibleChatters(candidates, host);
  const allUsernames = eligible.map(([, msgs]) => msgs[0].username).sort();

  const existing = await getPool(host).query<{ variant: number }>(
    `select variant from game_rounds where channel = $1 and game_date = $2`,
    [channel, gameDate]
  );
  const nextVariant = (existing.rows[0]?.variant ?? -1) + 1;
  const { userId, chosen } = pickRoundCandidate(eligible, roundSeed(channel, gameDate, nextVariant));
  const usernameHints = capUsernameHints(allUsernames, chosen[0]?.username, getUsernameHintsLimit(host));

  const roundId = crypto.randomUUID();
  const { rows } = await getPool(host).query(
    `insert into game_rounds (id, channel, user_id, message_ids, max_guesses, game_date, variant, username_hints)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (channel, game_date) do update
       set id = excluded.id,
           user_id = excluded.user_id,
           message_ids = excluded.message_ids,
           max_guesses = excluded.max_guesses,
           variant = excluded.variant,
           username_hints = excluded.username_hints,
           created_at = now()
     returning id, message_ids, max_guesses`,
    [roundId, channel, userId, chosen.map((c) => c.id), chosen.length, gameDate, nextVariant, usernameHints]
  );

  const row = rows[0];
  return buildNewRoundFromRow(row.id, gameDate, usernameHints, row.message_ids, row.max_guesses, host);
}

// The RNG seed for a given day's round. `variant` 0 always reproduces the
// exact seed string used before reroll support existed, so already-created
// rounds don't change their answer on deploy; only variant >= 1 (from an
// explicit reroll) changes the seed.
function roundSeed(channel: string, gameDate: string, variant: number): string {
  return variant > 0 ? `${channel}:${gameDate}:${variant}` : `${channel}:${gameDate}`;
}

type EligibleChatters = [number, CandidateRow[]][];

// Groups candidates by chatter and applies the min-eligible-messages and
// top-chatters-limit filters -- the exact pool a round's answer can be
// picked from. Shared by createRound/rerollRound (for the RNG pick) and by
// the username hint list, so the hints can never include a chatter who
// couldn't actually be the answer (e.g. one excluded by
// getTopChattersLimit()) nor omit one who could.
function computeEligibleChatters(candidates: CandidateRow[], host?: string | null): EligibleChatters {
  if (candidates.length === 0) {
    throw new Error('No candidate messages yet -- let the channel chat a bit more first.');
  }

  const byUser = new Map<number, CandidateRow[]>();
  for (const row of candidates) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  let eligible = [...byUser.entries()].filter(([, msgs]) => msgs.length >= MIN_MESSAGES_PER_ROUND);
  if (eligible.length === 0) {
    throw new Error('No chatter has enough unique, readable messages yet.');
  }

  // Caps the answer pool to the channel's top N chatters by eligible
  // message count (see getTopChattersLimit()). Ranked by message count
  // with user_id as a tiebreaker so the cut is deterministic regardless of
  // the candidates query's row order, then re-sorted by user_id so the
  // seeded pick below stays reproducible.
  const topChattersLimit = getTopChattersLimit(host);
  if (topChattersLimit && eligible.length > topChattersLimit) {
    eligible = eligible.sort((a, b) => b[1].length - a[1].length || a[0] - b[0]).slice(0, topChattersLimit);
  }
  eligible.sort((a, b) => a[0] - b[0]); // stable order so the seeded pick below is reproducible

  return eligible;
}

interface PickedRound {
  userId: number;
  chosen: CandidateRow[];
}

// Makes the seeded pick from an already-filtered/capped eligible pool (see
// computeEligibleChatters).
function pickRoundCandidate(eligible: EligibleChatters, seed: string): PickedRound {
  const rng = mulberry32(seedFromString(seed));
  const [userId, userMessages] = eligible[Math.floor(rng() * eligible.length)];
  const shuffled = seededShuffle(userMessages, rng);
  return { userId, chosen: shuffled.slice(0, MAX_GUESSES) };
}

// Row shape for the stored-round lookups in createRound (also the race
// fallback re-select) -- the game_rounds columns createRound actually reads.
interface StoredRoundRow {
  id: string;
  message_ids: number[];
  max_guesses: number;
  username_hints: string[] | null;
}

// Serves an already-created round from the DB without re-running the
// candidate-message query. Rounds created by this build have their
// username_hints column populated; rows from before the column existed
// (NULL hints) are backfilled once, lazily, on first read -- the heavy
// query still runs, but only once per legacy round instead of on every
// request, and the answer is unioned back into the hints regardless.
async function buildFromStoredRound(
  channel: string,
  gameDate: string,
  row: StoredRoundRow,
  host?: string | null
): Promise<NewRound> {
  if (row.username_hints && row.username_hints.length > 0) {
    return buildNewRoundFromRow(row.id, gameDate, row.username_hints, row.message_ids, row.max_guesses, host);
  }

  const candidates = await fetchCandidateMessages(channel, host);
  const eligible = computeEligibleChatters(candidates, host);
  const allUsernames = eligible.map(([, msgs]) => msgs[0].username).sort();
  const { rows } = await getPool(host).query<{ username: string }>(
    'select u.username from messages m join users u on u.id = m.user_id where m.id = $1',
    [row.message_ids[0]]
  );
  const usernameHints = capUsernameHints(allUsernames, rows[0]?.username, getUsernameHintsLimit(host));
  await getPool(host).query('update game_rounds set username_hints = $1 where id = $2', [usernameHints, row.id]);
  return buildNewRoundFromRow(row.id, gameDate, usernameHints, row.message_ids, row.max_guesses, host);
}

async function buildNewRoundFromRow(
  roundId: string,
  gameDate: string,
  usernameHints: string[],
  messageIds: number[],
  maxGuesses: number,
  host?: string | null
): Promise<NewRound> {
  const { rows } = await getPool(host).query(
    `select m.message_text, u.username
     from messages m
     join users u on u.id = m.user_id
     where m.id = $1`,
    [messageIds[0]]
  );
  return {
    roundId,
    gameDate,
    message: rows[0]?.message_text ?? '',
    guessesRemaining: maxGuesses,
    maxGuesses,
    usernameHints,
  };
}

// Caps the hint list to `limit` entries while guaranteeing the correct
// answer is always present in it -- otherwise a channel with more eligible
// chatters than the cap could occasionally hide the right answer from
// autocomplete entirely, which isn't the point of a "hint, not a spoiler"
// list. `correctUsername` is always expected to be a member of
// `allUsernames` since it comes from the same candidate pool.
function capUsernameHints(allUsernames: string[], correctUsername: string | undefined, limit: number): string[] {
  // allUsernames is recomputed from the *current* eligible-chatter pool on
  // every fetch, but that pool can drift after a round is created (e.g. a
  // duplicate message posted later makes one of the answer's messages
  // non-unique, dropping the answerer below the min-messages/top-chatters
  // cutoff). The round's answer is already locked in via message_ids, so it
  // must always be unioned back in here rather than silently omitted.
  const usernames =
    correctUsername && !allUsernames.includes(correctUsername)
      ? [...allUsernames, correctUsername].sort()
      : allUsernames;

  if (usernames.length <= limit) return usernames;
  if (!correctUsername) return usernames.slice(0, limit);

  const others = usernames.filter((name) => name !== correctUsername).slice(0, limit - 1);
  return [...others, correctUsername].sort();
}

// Fetches message texts for a set of ids, preserving the given order.
// Queries one id at a time (same pattern as the single-message lookups
// below) rather than a batched `where id = any(...)` + JS-side remap --
// Postgres can return bigint columns as strings, which would silently
// break a Map keyed by the numeric ids from game_rounds.message_ids.
async function fetchMessagesByIds(messageIds: number[], host?: string | null): Promise<string[]> {
  const texts: string[] = [];
  for (const id of messageIds) {
    const { rows } = await getPool(host).query<{ message_text: string }>(
      'select message_text from messages where id = $1',
      [id]
    );
    texts.push(rows[0]?.message_text ?? '');
  }
  return texts;
}

interface RoundRow {
  channel: string;
  message_ids: number[];
  max_guesses: number;
  username: string;
  color: string | null;
  badges: unknown;
}

// Shared round lookup for submitGuess/skipMessage -- both need the round's
// channel/messages/answer and the answerer's color/badge data, and both fail
// identically when the round can't be found.
async function fetchRound(roundId: string, host?: string | null): Promise<RoundRow> {
  const { rows } = await getPool(host).query<RoundRow>(
    `select gr.channel, gr.message_ids, gr.max_guesses, u.username, ucs.color, ucs.badges
     from game_rounds gr
     join users u on u.id = gr.user_id
     left join user_channel_state ucs on ucs.user_id = gr.user_id and ucs.channel = gr.channel
     where gr.id = $1`,
    [roundId]
  );
  if (rows.length === 0) throw new Error("Round not found -- refresh to get today's round.");
  return rows[0];
}

// Grading is stateless and per-request: the client tracks how many guesses
// it has already used (in localStorage) and passes that count in. This lets
// every player attempt the same shared daily round independently without a
// server-side "guesses used" counter that different players would stomp on.
export async function submitGuess(
  roundId: string,
  guessRaw: string,
  guessNumber: number,
  host?: string | null
): Promise<GuessResult> {
  const round = await fetchRound(roundId, host);

  if (!Number.isInteger(guessNumber) || guessNumber < 0 || guessNumber >= round.max_guesses) {
    throw new Error('Invalid guess index.');
  }

  const guess = guessRaw.trim().toLowerCase();
  const correct = guess.length > 0 && guess === round.username.toLowerCase();

  if (correct) {
    const allMessages = await fetchMessagesByIds(round.message_ids, host);
    const answerHint = await buildAnswerHint(round.badges, round.color, round.channel, host);
    return { correct: true, gameOver: true, correctUsername: round.username, allMessages, answerHint };
  }

  const nextIndex = guessNumber + 1;
  const gameOver = nextIndex >= round.max_guesses;

  let nextMessage: string | null = null;
  let allMessages: string[] | undefined;
  let hint: RoundHint | undefined;
  let answerHint: RoundHint | undefined;
  if (!gameOver) {
    const messageIds: number[] = round.message_ids;
    const nextId = messageIds[nextIndex];
    const { rows: msgRows } = await getPool(host).query('select message_text from messages where id = $1', [nextId]);
    nextMessage = msgRows[0]?.message_text ?? null;
    hint = await buildHintForRound(nextIndex, round.username, round.color, round.badges, round.channel, host);
  } else {
    allMessages = await fetchMessagesByIds(round.message_ids, host);
    answerHint = await buildAnswerHint(round.badges, round.color, round.channel, host);
  }

  return {
    correct: false,
    gameOver,
    guessesRemaining: round.max_guesses - nextIndex,
    nextMessage,
    correctUsername: gameOver ? round.username : undefined,
    allMessages,
    hint,
    answerHint,
  };
}

// Player-facing "skip": advances to the next message and consumes one guess,
// exactly like a wrong guess -- including revealing the easy-mode hint the
// next round would normally unlock, so skipping can't be used to dodge the
// hint schedule. Skipping the round's last message ends it as a loss, same
// as running out of guesses.
export async function skipMessage(roundId: string, guessNumber: number, host?: string | null): Promise<GuessResult> {
  const round = await fetchRound(roundId, host);

  if (!Number.isInteger(guessNumber) || guessNumber < 0 || guessNumber >= round.max_guesses) {
    throw new Error('Invalid guess index.');
  }

  const nextIndex = guessNumber + 1;
  const gameOver = nextIndex >= round.max_guesses;

  let nextMessage: string | null = null;
  let allMessages: string[] | undefined;
  let hint: RoundHint | undefined;
  let answerHint: RoundHint | undefined;
  if (!gameOver) {
    const messageIds: number[] = round.message_ids;
    const nextId = messageIds[nextIndex];
    const { rows: msgRows } = await getPool(host).query('select message_text from messages where id = $1', [nextId]);
    nextMessage = msgRows[0]?.message_text ?? null;
    hint = await buildHintForRound(nextIndex, round.username, round.color, round.badges, round.channel, host);
  } else {
    allMessages = await fetchMessagesByIds(round.message_ids, host);
    answerHint = await buildAnswerHint(round.badges, round.color, round.channel, host);
  }

  return {
    correct: false,
    gameOver,
    guessesRemaining: round.max_guesses - nextIndex,
    nextMessage,
    correctUsername: gameOver ? round.username : undefined,
    allMessages,
    hint,
    answerHint,
  };
}
