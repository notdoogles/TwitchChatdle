'use client';

import type { ReactNode } from 'react';
import styles from './GameBoard.module.css';
import type { EmoteRef, MessageLine } from '@/lib/messageLine';

// Emote image URL for a captured occurrence: Twitch emotes come from
// Twitch's static emoticon CDN (same scale as lib/stats.ts), 7TV ones from
// the 7TV CDN. Both are immutable public URLs derived from the emote id, so
// no lookup or caching layer is needed at render time. Returns null only
// for an unknown provider, which the caller renders as plain text.
export function emoteImageUrl(emote: EmoteRef): string | null {
  if (emote.provider === '7tv') return `https://cdn.7tv.app/emote/${emote.id}/2x.webp`;
  if (emote.provider === 'twitch') return `https://static-cdn.jtvnw.net/emoticons/v2/${emote.id}/default/dark/2.0`;
  return null;
}

// Renders a message line with its captured emotes spliced back in as
// images, falling back to the emote's code text whenever a URL can't be
// resolved. Emotes arrive pre-normalized (see toMessageLine in lib/game.ts)
// but this still guards against overlapping or out-of-range offsets so a
// corrupt row can never crash the chat log.
export default function EmoteLine({ line }: { line: MessageLine }) {
  if (line.emotes.length === 0) return <>{line.text}</>;

  const sorted = [...line.emotes].sort((a, b) => a.start - b.start);
  const nodes: (string | ReactNode)[] = [];
  let cursor = 0;
  for (const emote of sorted) {
    const end = emote.start + emote.code.length;
    if (emote.start < cursor || end > line.text.length) continue;
    if (emote.start > cursor) nodes.push(line.text.slice(cursor, emote.start));
    const url = emoteImageUrl(emote);
    nodes.push(
      url ? (
        <img key={`${emote.start}-${emote.id}`} src={url} alt={emote.code} title={emote.code} className={styles.emote} />
      ) : (
        emote.code
      )
    );
    cursor = end;
  }
  if (cursor < line.text.length) nodes.push(line.text.slice(cursor));
  return <>{nodes}</>;
}
