// Wordle-style share text for a finished round (see GameBoard.tsx): a header
// line with the score, a row of emoji tiles (one per guess), and the game's
// URL so whoever reads the paste can play the same daily round. Pure string
// building -- no DOM -- so it's unit-testable in the node vitest env.

// Entries in GameBoard.tsx's `guesses` list are raw usernames, except skipped
// messages which are stored as this sentinel label. Kept here (and imported by
// the component) so the share grid matches how the UI renders skips.
export const SKIPPED_GUESS_LABEL = 'Skipped';

// Tiles: green = the winning guess, red = a wrong guess, dark = a skipped
// message. A round only ends in a win on the guess that got it right, so a
// win's final tile is always green.
const TILE_CORRECT = '🟩';
const TILE_WRONG = '🟥';
const TILE_SKIPPED = '⬛';

export interface BuildShareTextParams {
  gameName: string;
  gameDate: string;
  guesses: string[];
  maxGuesses: number;
  status: 'won' | 'lost';
  url: string;
}

export function buildShareText({ gameName, gameDate, guesses, maxGuesses, status, url }: BuildShareTextParams): string {
  const score = status === 'won' ? `${guesses.length}/${maxGuesses}` : `X/${maxGuesses}`;
  const tiles = guesses
    .map((g, i) => {
      if (g === SKIPPED_GUESS_LABEL) return TILE_SKIPPED;
      return status === 'won' && i === guesses.length - 1 ? TILE_CORRECT : TILE_WRONG;
    })
    .join('');
  return [`${gameName} ${gameDate} ${score}`, '', tiles, '', url].join('\n');
}
