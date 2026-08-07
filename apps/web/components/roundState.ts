// Pure helpers for the round state GameBoard owns, extracted from the
// component so the guess/skip state update can be unit tested without a DOM
// and shared by the two handlers without drifting apart.

import type { RoundHint } from '@/lib/hints';

export type Status = 'loading' | 'playing' | 'won' | 'lost' | 'error';

// The slice of GameBoard state that a guess/skip response mutates.
export interface RoundState {
  guesses: string[];
  lines: string[];
  status: Status;
  correctUsername: string | null;
  resultImage: string | null;
  allMessages: string[] | null;
  hints: RoundHint;
  answerHint: RoundHint;
}

// The round a server component resolved for the day (see app/page.tsx),
// passed into GameBoard so the first paint shows the first message instead
// of a client round trip + loading state.
export interface InitialRound {
  gameDate: string;
  roundId: string;
  maxGuesses: number;
  message: string;
  usernameHints: string[];
}

// Shape of the shared /api/game/guess and /api/game/skip responses, as far
// as the client-side state update cares.
export interface GuessResultData {
  correct: boolean;
  gameOver: boolean;
  nextMessage?: string | null;
  correctUsername?: string;
  allMessages?: string[];
  hint?: RoundHint;
  answerHint?: RoundHint;
}

// Picks (once) a random image from the given pool, so it stays the same
// for the rest of the day instead of changing on every re-render. Returns
// null if the pool is empty (e.g. no images were dropped into
// public/static/winners or public/static/losers).
export function pickResultImage(pool: string[]): string | null {
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Applies a guess/skip response to the current round state, returning the
// new state plus whether the results modal should open. `newGuess` is the
// trimmed username (or SKIPPED_GUESS_LABEL for a skip) appended to the
// guess history.
export function applyRoundResult(
  state: RoundState,
  data: GuessResultData,
  newGuess: string,
  winnerImages: string[],
  loserImages: string[]
): { state: RoundState; openModal: boolean } {
  const guesses = [...state.guesses, newGuess];
  let lines = state.lines;
  let status: Status = state.status;
  let correctUsername = state.correctUsername;
  let resultImage = state.resultImage;
  let allMessages = state.allMessages;
  let hints = state.hints;
  let answerHint = state.answerHint;

  if (data.correct) {
    status = 'won';
    correctUsername = data.correctUsername ?? null;
    resultImage = pickResultImage(winnerImages);
    allMessages = data.allMessages ?? null;
    answerHint = data.answerHint ?? {};
  } else {
    if (data.nextMessage) lines = [...lines, data.nextMessage];
    if (data.hint) hints = { ...hints, ...data.hint };
    if (data.gameOver) {
      status = 'lost';
      correctUsername = data.correctUsername ?? null;
      resultImage = pickResultImage(loserImages);
      allMessages = data.allMessages ?? null;
      answerHint = data.answerHint ?? {};
    }
  }

  return {
    state: { guesses, lines, status, correctUsername, resultImage, allMessages, hints, answerHint },
    openModal: status === 'won' || status === 'lost',
  };
}
