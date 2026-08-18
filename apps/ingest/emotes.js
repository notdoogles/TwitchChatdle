// Pure logic extracted from index.js so it can be unit tested without
// connecting to Twitch or Postgres. index.js wires this into the tmi.js
// client to capture which emotes each logged message used.
//
// tmi.js already parses the IRC `emotes` tag into an object keyed by emote
// id whose values are character-range strings ("0-4") for every occurrence
// of that emote in the message. The code (e.g. "Kappa") is recovered by
// slicing the message text at those positions, since the tag itself only
// carries positions, not codes.

const RANGE_PATTERN = /^(\d+)-(\d+)$/;

// Accepts either a "0-4" range string (tmi.js parsed form) or a [0, 4]
// number pair, returning [start, end] or null when malformed.
function rangeToStartEnd(range) {
  if (Array.isArray(range)) {
    if (range.length < 2 || typeof range[0] !== 'number' || typeof range[1] !== 'number') return null;
    return [range[0], range[1]];
  }
  const match = RANGE_PATTERN.exec(String(range));
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

// Parses the raw IRC `emotes` tag format ("25:0-4,6-10/1902:12-15") into the
// same emote-id -> range-strings object tmi.js produces, so the function
// also works if a future tmi.js version stops pre-parsing the tag.
function parseRawEmotesTag(raw) {
  const byId = {};
  for (const part of raw.split('/')) {
    const [id, rangesPart] = part.split(':');
    if (!id || !rangesPart) continue;
    byId[id] = rangesPart.split(',');
  }
  return byId;
}

// Extracts the emotes used in `message` from the IRC tags tmi.js delivered.
// Returns an array of { id, code } -- one entry per occurrence, in the order
// the emotes appear in the message -- or null when the message has no
// emotes (the tag is only present when it does). `tags` is the tmi.js tags
// object for the message; `tags.emotes` is expected to already be parsed to
// { emoteId: ['start-end', ...] }.
export function parseEmotes(tags, message) {
  if (!tags || typeof tags !== 'object' || typeof message !== 'string') return null;
  const raw = tags.emotes;
  if (!raw) return null;

  const byId = typeof raw === 'string' ? parseRawEmotesTag(raw) : raw;

  const occurrences = [];
  for (const [id, ranges] of Object.entries(byId)) {
    if (!Array.isArray(ranges)) continue;
    for (const range of ranges) {
      const [start, end] = rangeToStartEnd(range) ?? [];
      if (start == null || end == null || start < 0 || end >= message.length) continue;
      const code = message.slice(start, end + 1);
      if (!code) continue;
      occurrences.push({ start, id, code });
    }
  }
  if (occurrences.length === 0) return null;
  // The tag's object groups ranges by emote id, not message position, so
  // sort by character index to restore the order they appear in the text.
  occurrences.sort((a, b) => a.start - b.start);
  return occurrences.map(({ id, code }) => ({ id, code }));
}
