import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeEmoteOccurrences, parseEmotes } from './emotes.js';

const TWITCH_PROVIDER = { provider: 'twitch' };
const SEVENTV_PROVIDER = { provider: '7tv' };

test('parseEmotes extracts code, id, provider and start for every occurrence', () => {
  const tags = { emotes: { 25: ['0-4', '11-15'], 1902: ['17-24'] } };
  assert.deepEqual(parseEmotes(tags, 'Kappa test Kappa PogChamp'), [
    { start: 0, id: '25', code: 'Kappa', ...TWITCH_PROVIDER },
    { start: 11, id: '25', code: 'Kappa', ...TWITCH_PROVIDER },
    { start: 17, id: '1902', code: 'PogChamp', ...TWITCH_PROVIDER },
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
    { start: 0, id: '425618', code: 'LULW', ...TWITCH_PROVIDER },
    { start: 11, id: '425618', code: 'LULW', ...TWITCH_PROVIDER },
  ]);
});

test('parseEmotes handles the raw string tag format too', () => {
  const tags = { emotes: '25:0-4,11-15/1902:17-24' };
  assert.deepEqual(parseEmotes(tags, 'Kappa test Kappa PogChamp'), [
    { start: 0, id: '25', code: 'Kappa', ...TWITCH_PROVIDER },
    { start: 11, id: '25', code: 'Kappa', ...TWITCH_PROVIDER },
    { start: 17, id: '1902', code: 'PogChamp', ...TWITCH_PROVIDER },
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
  assert.deepEqual(parseEmotes(tags, 'Kappa hi'), [{ start: 0, id: '25', code: 'Kappa', ...TWITCH_PROVIDER }]);
});

test('mergeEmoteOccurrences interleaves twitch and 7tv occurrences by position', () => {
  const twitch = [
    { start: 5, id: '25', code: 'Kappa', ...TWITCH_PROVIDER },
    { start: 15, id: '1902', code: 'PogChamp', ...TWITCH_PROVIDER },
  ];
  const seventv = [{ start: 0, id: '7tv-1', code: 'KEKW', ...SEVENTV_PROVIDER }];
  assert.deepEqual(mergeEmoteOccurrences(twitch, seventv), [
    { start: 0, id: '7tv-1', code: 'KEKW', ...SEVENTV_PROVIDER },
    { start: 5, id: '25', code: 'Kappa', ...TWITCH_PROVIDER },
    { start: 15, id: '1902', code: 'PogChamp', ...TWITCH_PROVIDER },
  ]);
});

test('mergeEmoteOccurrences lets twitch win when a 7tv token overlaps', () => {
  const twitch = [{ start: 0, id: '25', code: 'KEKW', ...TWITCH_PROVIDER }];
  const seventv = [{ start: 0, id: '7tv-1', code: 'KEKW', ...SEVENTV_PROVIDER }];
  assert.deepEqual(mergeEmoteOccurrences(twitch, seventv), twitch);
});

test('mergeEmoteOccurrences returns null when there are no occurrences at all', () => {
  assert.equal(mergeEmoteOccurrences(null, []), null);
  assert.equal(mergeEmoteOccurrences(null, null), null);
});
