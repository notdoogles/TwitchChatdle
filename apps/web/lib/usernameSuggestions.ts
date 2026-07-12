// Pure filtering behind the guess box's autocomplete. Kept here (rather
// than inline in GameBoard) so the matching/ordering rules can be unit
// tested without a DOM: prefix matches rank above mid-string matches, the
// comparison is case-insensitive, and the list is capped so the dropdown
// can't grow tall enough to run off a small screen.

export const DEFAULT_SUGGESTION_LIMIT = 8;

export function filterUsernameSuggestions(
  hints: string[],
  query: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const seen = new Set<string>();
  const prefixMatches: string[] = [];
  const otherMatches: string[] = [];

  for (const hint of hints) {
    const lower = hint.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    const idx = lower.indexOf(q);
    if (idx === 0) prefixMatches.push(hint);
    else if (idx > 0) otherMatches.push(hint);
  }

  return [...prefixMatches, ...otherMatches].slice(0, Math.max(0, limit));
}
