import { describe, expect, it } from 'vitest';
import { buildShareText } from './shareText';

const base = {
  gameName: 'Chatdle',
  gameDate: '2026-08-03',
  maxGuesses: 5,
  url: 'https://example.com',
};

describe('buildShareText', () => {
  it('renders a win with score and one green tile for the winning guess', () => {
    expect(buildShareText({ ...base, guesses: ['aaa', 'bbb', 'ccc', 'winner'], status: 'won' })).toBe(
      `Chatdle 2026-08-03 4/5

🟥🟥🟥🟩

https://example.com`
    );
  });

  it('renders X/N and all-red tiles for a loss', () => {
    expect(buildShareText({ ...base, guesses: ['a', 'b', 'c', 'd', 'e'], status: 'lost' })).toBe(
      `Chatdle 2026-08-03 X/5

🟥🟥🟥🟥🟥

https://example.com`
    );
  });

  it('marks skipped messages with the dark tile', () => {
    expect(buildShareText({ ...base, guesses: ['Skipped', 'a', 'Skipped', 'winner'], status: 'won' })).toBe(
      `Chatdle 2026-08-03 4/5

⬛🟥⬛🟩

https://example.com`
    );
  });

  it('handles a win on the first guess', () => {
    expect(buildShareText({ ...base, guesses: ['winner'], status: 'won' })).toBe(
      `Chatdle 2026-08-03 1/5

🟩

https://example.com`
    );
  });

  it('handles a win using all five guesses', () => {
    const text = buildShareText({ ...base, guesses: ['a', 'b', 'c', 'd', 'winner'], status: 'won' });
    expect(text).toContain('Chatdle 2026-08-03 5/5');
    expect(text).toContain('🟥🟥🟥🟥🟩');
  });

  it('uses the given game name and URL', () => {
    const text = buildShareText({
      ...base,
      gameName: 'Elliebdle',
      url: 'https://elliebdle.doogl.es',
      guesses: ['winner'],
      status: 'won',
    });
    expect(text.startsWith('Elliebdle 2026-08-03 1/5')).toBe(true);
    expect(text.endsWith('https://elliebdle.doogl.es')).toBe(true);
  });
});
