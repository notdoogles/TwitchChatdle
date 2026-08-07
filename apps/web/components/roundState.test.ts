import { describe, expect, it } from 'vitest';
import { SKIPPED_GUESS_LABEL } from '../lib/shareText';
import { applyRoundResult, pickResultImage, RoundState } from './roundState';

const base: RoundState = {
  guesses: [],
  lines: ['first message'],
  status: 'playing',
  correctUsername: null,
  resultImage: null,
  allMessages: null,
  hints: {},
  answerHint: {},
};

describe('applyRoundResult', () => {
  it('ends as a win with all messages and answer hints on a correct guess', () => {
    const result = applyRoundResult(
      base,
      {
        correct: true,
        gameOver: true,
        correctUsername: 'Alice',
        allMessages: ['m1', 'm2', 'm3'],
        answerHint: { color: '#FF0000' },
      },
      'Alice',
      ['/win.png'],
      ['/lose.png']
    );
    expect(result.openModal).toBe(true);
    expect(result.state.status).toBe('won');
    expect(result.state.guesses).toEqual(['Alice']);
    expect(result.state.lines).toEqual(['first message']); // no next message on a win
    expect(result.state.allMessages).toEqual(['m1', 'm2', 'm3']);
    expect(result.state.answerHint).toEqual({ color: '#FF0000' });
    expect(result.state.correctUsername).toBe('Alice');
    expect(result.state.resultImage).toBe('/win.png');
  });

  it('stays playing on a wrong guess, appending the next message and hint', () => {
    const result = applyRoundResult(
      base,
      { correct: false, gameOver: false, nextMessage: 'second message', hint: { globalBadges: [] } },
      'bob',
      [],
      []
    );
    expect(result.openModal).toBe(false);
    expect(result.state.status).toBe('playing');
    expect(result.state.lines).toEqual(['first message', 'second message']);
    expect(result.state.hints).toEqual({ globalBadges: [] });
    expect(result.state.resultImage).toBeNull();
  });

  it('ends as a loss with the full transcript on the final wrong guess', () => {
    const result = applyRoundResult(
      base,
      {
        correct: false,
        gameOver: true,
        correctUsername: 'Alice',
        allMessages: ['m1', 'm2', 'm3', 'm4', 'm5'],
        answerHint: { usernameLength: 5 },
      },
      'bob',
      [],
      ['/lose.png']
    );
    expect(result.openModal).toBe(true);
    expect(result.state.status).toBe('lost');
    expect(result.state.lines).toEqual(['first message']); // no next message at game over
    expect(result.state.allMessages).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(result.state.answerHint).toEqual({ usernameLength: 5 });
    expect(result.state.resultImage).toBe('/lose.png');
  });

  it('records a skip as its sentinel label without marking it correct', () => {
    const result = applyRoundResult(
      base,
      { correct: false, gameOver: false, nextMessage: 'second message', hint: { globalBadges: [] } },
      SKIPPED_GUESS_LABEL,
      [],
      []
    );
    expect(result.state.guesses).toEqual([SKIPPED_GUESS_LABEL]);
    expect(result.state.status).toBe('playing');
  });
});

describe('pickResultImage', () => {
  it('returns null for an empty pool', () => {
    expect(pickResultImage([])).toBeNull();
  });

  it('always returns a member of the pool', () => {
    const pool = ['/a.png', '/b.png'];
    for (let i = 0; i < 20; i++) {
      expect(pool).toContain(pickResultImage(pool));
    }
  });
});
