import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import EmoteLine, { emoteImageUrl } from './EmoteLine';
import type { MessageLine } from '../lib/messageLine';

describe('emoteImageUrl', () => {
  it('builds the Twitch emoticon CDN URL from the emote id', () => {
    expect(emoteImageUrl({ id: '25', code: 'Kappa', provider: 'twitch', start: 0 })).toBe(
      'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0'
    );
  });

  it('builds the 7TV CDN URL from the emote id', () => {
    expect(emoteImageUrl({ id: '7tv-uuid', code: 'KEKW', provider: '7tv', start: 0 })).toBe(
      'https://cdn.7tv.app/emote/7tv-uuid/2x.webp'
    );
  });

  it('returns null for an unknown provider', () => {
    expect(emoteImageUrl({ id: '1', code: 'x', provider: 'other' as never, start: 0 })).toBeNull();
  });
});

const line = (text: string, emotes: MessageLine['emotes']): MessageLine => ({ text, emotes });

describe('EmoteLine', () => {
  it('renders plain text when there are no emotes', () => {
    expect(renderToStaticMarkup(<EmoteLine line={line('just words', [])} />)).toBe('just words');
  });

  it('splices emote images into the text at their recorded positions', () => {
    const out = renderToStaticMarkup(
      <EmoteLine
        line={line('Kappa test Kappa', [
          { id: '25', code: 'Kappa', provider: 'twitch', start: 0 },
          { id: '25', code: 'Kappa', provider: 'twitch', start: 11 },
        ])}
      />
    );
    expect(out).toBe(
      '<img src="https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0" alt="Kappa" title="Kappa"/> test <img src="https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0" alt="Kappa" title="Kappa"/>'
    );
  });

  it('renders a 7TV emote from the 7TV CDN', () => {
    const out = renderToStaticMarkup(<EmoteLine line={line('KEKW hi', [{ id: 'u-1', code: 'KEKW', provider: '7tv', start: 0 }])} />);
    expect(out).toBe('<img src="https://cdn.7tv.app/emote/u-1/2x.webp" alt="KEKW" title="KEKW"/> hi');
  });

  it('skips out-of-range or overlapping emotes instead of crashing', () => {
    const out = renderToStaticMarkup(
      <EmoteLine
        line={line('hey Kappa', [
          { id: '25', code: 'Kappa', provider: 'twitch', start: 4 },
          { id: '26', code: 'Kappa', provider: 'twitch', start: 4 },
          { id: '27', code: 'oops', provider: 'twitch', start: 99 },
        ])}
      />
    );
    expect(out).toBe('hey <img src="https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0" alt="Kappa" title="Kappa"/>');
  });
});
