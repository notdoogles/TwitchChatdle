// Copy + version for the in-game "what's new" announcement modal
// (GameBoard.tsx). Bump CURRENT_ANNOUNCEMENT_VERSION (and update the copy
// below) whenever a future change is worth re-announcing to returning
// players -- players who previously checked "don't show this again" only
// have *this* version permanently dismissed, so a higher version shows the
// modal again automatically. See GameBoard.tsx for the dismissal storage.
export const CURRENT_ANNOUNCEMENT_VERSION = 1;

export const ANNOUNCEMENT_TITLE = 'New: Easy Mode';

export const ANNOUNCEMENT_INTRO =
  "There's now an Easy/Hard mode toggle above the chat log. Hard mode is the game as it's always been. Easy mode reveals one extra hint per round, building on top of the last:";

export const ANNOUNCEMENT_FEATURES: string[] = [
  "Round 2: the chatter's global Twitch badge (Prime, Turbo, Partner, Staff, etc.)",
  "Round 3: the chatter's font color",
  "Round 4: the chatter's channel-specific badge (Mod, VIP, Subscriber, Founder, etc.)",
  "Round 5: the chatter's username length",
];
