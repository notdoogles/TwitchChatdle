// Client-safe message-line types and normalization, deliberately free of
// any server-only imports (no pg, no crypto): components import this
// directly instead of lib/game.ts, which would drag the pg client into the
// browser bundle (and fail Vercel's webpack build on node builtins like
// `tls`). lib/game.ts re-exports the types for API-side consumers.

// One captured emote occurrence within a message. Stored per message in
// messages.emotes at ingest time ({id, code, provider, start} -- see
// apps/ingest/emotes.js), carried through the API so the client can splice
// the emote's image into the revealed text without re-parsing it.
export type EmoteProvider = 'twitch' | '7tv';

export interface EmoteRef {
  id: string;
  code: string;
  provider: EmoteProvider;
  // Character offset of the emote within the message text.
  start: number;
}

// A message as the game UI consumes it: the raw text plus which spans of
// it are emotes (empty when the message had none, or was logged before
// emote capture existed).
export interface MessageLine {
  text: string;
  emotes: EmoteRef[];
}

// Normalizes anything a client/localStorage/API payload might hold into a
// valid MessageLine: plain strings (older builds stored lines as strings)
// and DB rows whose emotes predate the provider/start fields both degrade
// to text-only rendering rather than erroring.
export function toMessageLine(value: unknown): MessageLine {
  if (typeof value === 'string') return { text: value, emotes: [] };
  if (value && typeof value === 'object') {
    const { text, emotes } = value as { text?: unknown; emotes?: unknown };
    if (typeof text === 'string') {
      const refs: EmoteRef[] = [];
      if (Array.isArray(emotes)) {
        for (const entry of emotes) {
          if (!entry || typeof entry !== 'object') continue;
          const { id, code, provider, start } = entry as Partial<EmoteRef>;
          if (typeof id !== 'string' || id.length === 0 || typeof code !== 'string' || code.length === 0) continue;
          if (provider !== 'twitch' && provider !== '7tv') continue;
          if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || start + code.length > text.length) {
            continue;
          }
          refs.push({ id, code, provider, start });
        }
      }
      refs.sort((a, b) => a.start - b.start);
      return { text, emotes: refs };
    }
  }
  return { text: String(value ?? ''), emotes: [] };
}
