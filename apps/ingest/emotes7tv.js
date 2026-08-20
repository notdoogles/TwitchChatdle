// 7TV channel-emote capture, extracted from index.js so it can be unit
// tested without connecting to Twitch or Postgres.
//
// Twitch's IRC `emotes` tag only covers Twitch emotes -- 7TV emotes arrive
// as plain text tokens. To recover which tokens are emotes, the channel's
// 7TV emote set is fetched from the public v3 API (no auth needed) and
// matched against the message's whitespace-delimited tokens. Codes are
// case-sensitive, exactly like real chat rendering: "KEKW" matches, "kekw"
// doesn't.
//
// Only channel-level sets are tracked (the channel's own emotes, resolved
// by its numeric Twitch user id -- the same `room-id` IRC tag index.js
// already uses); per-user personal 7TV emotes are out of scope for now.

const SEVENTV_USER_URL = 'https://7tv.io/v3/users/twitch/';

// Fetches a channel's 7TV emote set by its numeric Twitch user id, returning
// a Map of exact code -> {id, name} or null when the channel has no 7TV set
// (404), the API is unreachable, or the response shape is unexpected.
// Never throws -- the ingest worker treats 7TV as best-effort enrichment.
export async function fetchSeventvEmoteSet(twitchUserId, fetchImpl = fetch) {
  if (!twitchUserId) return null;
  try {
    const res = await fetchImpl(`${SEVENTV_USER_URL}${encodeURIComponent(twitchUserId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const emotes = data?.emote_set?.emotes;
    if (!Array.isArray(emotes)) return null;
    const byCode = new Map();
    for (const emote of emotes) {
      if (typeof emote?.id !== 'string' || typeof emote?.name !== 'string' || emote.name.length === 0) continue;
      byCode.set(emote.name, { id: emote.id, name: emote.name });
    }
    return byCode;
  } catch {
    return null;
  }
}

// Scans `message` for tokens that exactly match codes in `emoteSet` (a Map
// as returned by fetchSeventvEmoteSet). Returns one
// {start, id, code, provider: '7tv'} per occurrence, in message order, or
// an empty array when the message has no matching tokens (or no set was
// provided). Matching is per whitespace-delimited token and case-sensitive,
// so 7TV's own chat rendering rules are preserved. The caller merges these
// with Twitch occurrences and lets Twitch win on overlap (see
// mergeEmoteOccurrences in emotes.js).
export function parseSeventvEmotes(message, emoteSet) {
  if (!emoteSet || typeof message !== 'string') return [];

  const occurrences = [];
  let i = 0;
  while (i < message.length) {
    while (i < message.length && isWhitespace(message[i])) i++;
    if (i === message.length) break;
    const start = i;
    while (i < message.length && !isWhitespace(message[i])) i++;
    const token = message.slice(start, i);
    const emote = emoteSet.get(token);
    if (emote) occurrences.push({ start, id: emote.id, code: emote.name, provider: '7tv' });
  }
  return occurrences;
}

function isWhitespace(char) {
  return /\s/.test(char);
}
