import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEmotes } from './emotes.js';

test('parseEmotes extracts code and id for every occurrence', () => {
  const tags = { emotes: { 25: ['0-4', '11-15'], 1902: ['17-24'] } };
  assert.deepEqual(parseEmotes(tags, 'Kappa test Kappa PogChamp'), [
    { id: '25', code: 'Kappa' },
    { id: '25', code: 'Kappa' },
    { id: '1902', code: 'PogChamp' },
  ]);
});

test('parseEmotes returns null when the message has no emotes', () => {
  assert.equal(parseEmotes({}, 'just words'), null);
  assert.equal(parseEmotes({ emotes: undefined }, 'just words'), null);
  assert.equal(parseEmotes({ emotes: null }, 'just words'), null);
  assert.equal(parseEmotes(undefined, 'just words'), null);
});

test('parseEmotes handles multi-character-position ranges', () => {
  const tags = { emotes: { 425618: ['0-3', '11-14'] } };
  assert.deepEqual(parseEmotes(tags, 'LULW hello LULW'), [
    { id: '425618', code: 'LULW' },
    { id: '425618', code: 'LULW' },
  ]);
});

test('parseEmotes handles the raw string tag format too', () => {
  const tags = { emotes: '25:0-4,11-15/1902:17-24' };
  assert.deepEqual(parseEmotes(tags, 'Kappa test Kappa PogChamp'), [
    { id: '25', code: 'Kappa' },
    { id: '25', code: 'Kappa' },
    { id: '1902', code: 'PogChamp' },
  ]);
});

test('parseEmotes skips malformed ranges', () => {
  assert.deepEqual(parseEmotes({ emotes: { 25: ['oops'] } }, 'Kappa'), null);
  assert.deepEqual(parseEmotes({ emotes: { 25: ['0-99'] } }, 'Kappa'), null);
  assert.deepEqual(parseEmotes({ emotes: { 25: ['3-1'] } }, 'Kappa'), null);
  assert.deepEqual(parseEmotes({ emotes: { 25: [['not', 'nums']] } }, 'Kappa'), null);
});

test('parseEmotes handles numeric [start, end] pairs', () => {
  const tags = { emotes: { 25: [[0, 4]] } };
  assert.deepEqual(parseEmotes(tags, 'Kappa hi'), [{ id: '25', code: 'Kappa' }]);
});
