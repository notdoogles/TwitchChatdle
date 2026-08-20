import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchSeventvEmoteSet, parseSeventvEmotes } from './emotes7tv.js';

function emoteSet(...pairs) {
  return new Map(pairs.map(([name, id]) => [name, { id, name }]));
}

test('parseSeventvEmotes matches exact-case whitespace-delimited tokens', () => {
  const set = emoteSet(['KEKW', '7tv-id-1'], ['PogO', '7tv-id-2']);
  assert.deepEqual(parseSeventvEmotes('KEKW hey KEKW PogO', set), [
    { start: 0, id: '7tv-id-1', code: 'KEKW' },
    { start: 9, id: '7tv-id-1', code: 'KEKW' },
    { start: 14, id: '7tv-id-2', code: 'PogO' },
  ]);
});

test('parseSeventvEmotes is case-sensitive like real chat', () => {
  const set = emoteSet(['KEKW', '7tv-id-1']);
  assert.deepEqual(parseSeventvEmotes('kekw KEKW KeKw', set), [
    { start: 5, id: '7tv-id-1', code: 'KEKW' },
  ]);
});

test('parseSeventvEmotes never matches inside a longer token', () => {
  const set = emoteSet(['Pog', '7tv-id-1']);
  assert.deepEqual(parseSeventvEmotes('PogChamp Pog Poggers', set), [
    { start: 9, id: '7tv-id-1', code: 'Pog' },
  ]);
});

test('parseSeventvEmotes returns empty for no set, no match, or non-string', () => {
  assert.deepEqual(parseSeventvEmotes('KEKW', null), []);
  assert.deepEqual(parseSeventvEmotes('no emotes here', emoteSet(['KEKW', '7tv-id-1'])), []);
  assert.deepEqual(parseSeventvEmotes(undefined, emoteSet(['KEKW', '7tv-id-1'])), []);
});

test('parseSeventvEmotes records positions across multiple whitespace runs', () => {
  const set = emoteSet(['EZ', '7tv-id-1'], ['catJAM', '7tv-id-2']);
  assert.deepEqual(parseSeventvEmotes('  EZ   catJAM', set), [
    { start: 2, id: '7tv-id-1', code: 'EZ' },
    { start: 7, id: '7tv-id-2', code: 'catJAM' },
  ]);
});

test('fetchSeventvEmoteSet maps the v3 user payload to a code map', async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        id: 'user-uuid',
        twitch_id: '12345',
        emote_set: {
          id: 'set-uuid',
          name: 'Channel Set',
          emotes: [
            { id: 'emote-1', name: 'KEKW', data: {} },
            { id: 'emote-2', name: 'catJAM', data: {} },
          ],
        },
      }),
      { status: 200 }
    );
  const set = await fetchSeventvEmoteSet('12345', fetchImpl);
  assert.equal(set.get('KEKW').id, 'emote-1');
  assert.equal(set.get('catJAM').id, 'emote-2');
  assert.equal(set.size, 2);
});

test('fetchSeventvEmoteSet returns null when the channel has no 7TV set', async () => {
  const fetchImpl = async () => new Response('{}', { status: 404 });
  assert.equal(await fetchSeventvEmoteSet('12345', fetchImpl), null);
});

test('fetchSeventvEmoteSet returns null on network failure or unexpected shape', async () => {
  assert.equal(await fetchSeventvEmoteSet('12345', async () => { throw new Error('boom'); }), null);
  const empty = async () => new Response(JSON.stringify({ id: 'x' }), { status: 200 });
  assert.equal(await fetchSeventvEmoteSet('12345', empty), null);
  assert.equal(await fetchSeventvEmoteSet(undefined, async () => new Response('{}', { status: 200 })), null);
});
