import { describe, expect, it } from 'vitest';
import { toMessageLine } from './messageLine';

describe('toMessageLine', () => {
  it('turns a plain string (legacy localStorage line) into a text-only line', () => {
    expect(toMessageLine('just words')).toEqual({ text: 'just words', emotes: [] });
  });

  it('passes through a MessageLine object unchanged', () => {
    const line = {
      text: 'Kappa hey',
      emotes: [{ id: '25', code: 'Kappa', provider: 'twitch', start: 0 }],
    };
    expect(toMessageLine(line)).toEqual(line);
  });

  it('sorts emotes by start position and keeps valid occurrences', () => {
    expect(
      toMessageLine({
        text: 'hey KEKW Kappa',
        emotes: [
          { id: '7tv-1', code: 'KEKW', provider: '7tv', start: 4 },
          { id: '25', code: 'Kappa', provider: 'twitch', start: 9 },
        ],
      })
    ).toEqual({
      text: 'hey KEKW Kappa',
      emotes: [
        { id: '7tv-1', code: 'KEKW', provider: '7tv', start: 4 },
        { id: '25', code: 'Kappa', provider: 'twitch', start: 9 },
      ],
    });
  });

  it('drops emotes with unknown providers, missing fields, or out-of-range offsets', () => {
    expect(
      toMessageLine({
        text: 'Kappa hi',
        emotes: [
          { id: '25', code: 'Kappa', provider: 'twitch', start: 0 },
          { id: '26', code: 'Kappa', provider: 'twitch' }, // no start
          { id: '27', code: 'x', provider: 'other', start: 0 },
          { id: '28', code: 'oops', provider: '7tv', start: 99 },
          { id: '', code: 'Kappa', provider: '7tv', start: 0 },
        ],
      })
    ).toEqual({
      text: 'Kappa hi',
      emotes: [{ id: '25', code: 'Kappa', provider: 'twitch', start: 0 }],
    });
  });

  it('treats missing or empty input as an empty line', () => {
    expect(toMessageLine(null)).toEqual({ text: '', emotes: [] });
    expect(toMessageLine(undefined)).toEqual({ text: '', emotes: [] });
    expect(toMessageLine('')).toEqual({ text: '', emotes: [] });
  });
});
