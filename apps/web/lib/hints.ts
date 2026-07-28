// Shared, side-effect-free types/helpers for the easy-mode hint system, kept
// separate from lib/game.ts (which imports `pg`) so this module is safe to
// import from client components (GameBoard.tsx) without pulling a Postgres
// driver into the browser bundle.

// A hint's key being present (even with a `null`/falsy value) means that
// hint has been *revealed*; the value itself is the revealed data (or
// null/empty to mean "this chatter has none of that"). Keys are set
// cumulatively, one per guess, in this order: globalBadge (round 2) -> color
// (round 3) -> channelBadge (round 4) -> usernameLength (round 5).
export interface RoundHint {
  globalBadge?: string | null;
  globalBadgeIcon?: string | null;
  color?: string | null;
  channelBadge?: string | null;
  channelBadgeIcon?: string | null;
  usernameLength?: number;
}

export const NONE_LABEL = 'None';
export const DEFAULT_COLOR_LABEL = 'Default';

// The masked username shown in place of "???" stays this length until the
// round 5 hint reveals the chatter's real username length (easy mode only).
export const DEFAULT_MASK_LENGTH = 3;

// Builds the "???" placeholder shown for the hidden chatter name. All of a
// round's messages come from the same chatter, so every visible chat line
// uses the same mask.
export function maskForHint(hint: RoundHint): string {
  const length = hint.usernameLength ?? DEFAULT_MASK_LENGTH;
  return '?'.repeat(Math.max(1, length));
}
