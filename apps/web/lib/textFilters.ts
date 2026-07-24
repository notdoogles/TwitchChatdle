// R9K-style uniqueness relies on comparing this normalized form across all
// messages in a channel (done in SQL, see lib/game.ts). This just defines
// what "the same message" means: case, surrounding whitespace, and repeated
// internal whitespace shouldn't count as different messages.
export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Tokens that look like emotes rather than words: ALLCAPS (KEKW, LULW,
// OMEGALUL), camelCase (PogChamp, monkaS), or letters mixed with digits in a
// way that isn't a normal word (5Head, 4Head). This is a heuristic, not a
// dictionary -- it errs toward rejecting borderline tokens since the game
// only needs a decent pool of clearly-readable messages, not every message.
const ALL_CAPS = /^[A-Z]{3,}$/;
const CAMEL_CASE = /[a-z][A-Z]/;
const DIGIT_LETTER_MIX = /[0-9].*[A-Za-z]|[A-Za-z].*[0-9]/;
const WORDLIKE = /^[a-zA-Z']{2,}$/;

function isEmoteLikeToken(token: string): boolean {
  const clean = token.replace(/[^\w']/g, '');
  if (!clean) return true; // pure punctuation/symbols, e.g. ":)" "<3"
  if (ALL_CAPS.test(clean)) return true;
  if (CAMEL_CASE.test(clean)) return true;
  if (DIGIT_LETTER_MIX.test(clean)) return true;
  return false;
}

export interface IntelligibilityOptions {
  minLength?: number;
  minTokens?: number;
  minWordRatio?: number;
  maxLength?: number;
  maxTokens?: number;
}

const DEFAULTS: Required<IntelligibilityOptions> = {
  minLength: 12,
  minTokens: 3,
  minWordRatio: 0.6,
  maxLength: 500,
  maxTokens: 60,
};

// Rejects messages that are too short, link-only, or mostly emotes/symbols,
// so the game only surfaces messages a guesser could plausibly read and
// vibe-match to a person, rather than spam or an emote spread. Also rejects
// messages that are too long (copypasta walls of text make for an
// unreadable/unfair round) via maxLength/maxTokens.
export function isIntelligible(rawText: string, options: IntelligibilityOptions = {}): boolean {
  const { minLength, minTokens, minWordRatio, maxLength, maxTokens } = { ...DEFAULTS, ...options };
  const text = rawText.trim();

  if (text.length < minLength || text.length > maxLength) return false;
  if (/^https?:\/\//i.test(text)) return false;

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < minTokens || tokens.length > maxTokens) return false;

  const wordTokens = tokens.filter((t) => {
    const clean = t.replace(/[^\w']/g, '');
    return WORDLIKE.test(clean) && !isEmoteLikeToken(t);
  });

  return wordTokens.length / tokens.length >= minWordRatio;
}
