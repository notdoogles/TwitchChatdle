import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExcluded, mergeExcludedUsernames, parseExcludedFromEnv, shouldSkipMessage } from './filters.js';

test('parseExcludedFromEnv', () => {
  assert.deepEqual(parseExcludedFromEnv('nightbot, StreamElements ,some_user'), [
    'nightbot',
    'streamelements',
    'some_user',
  ]);
});

test('parseExcludedFromEnv handles empty/undefined input', () => {
  assert.deepEqual(parseExcludedFromEnv(undefined), []);
  assert.deepEqual(parseExcludedFromEnv(''), []);
  assert.deepEqual(parseExcludedFromEnv('  ,, '), []);
});

test('mergeExcludedUsernames dedupes and lowercases both sources', () => {
  const merged = mergeExcludedUsernames(['nightbot', 'some_user'], ['Some_User', 'StreamElements']);
  assert.deepEqual([...merged].sort(), ['nightbot', 'some_user', 'streamelements']);
});

test('isExcluded matches case-insensitively', () => {
  const excluded = mergeExcludedUsernames(['nightbot'], []);
  assert.equal(isExcluded('NightBot', excluded), true);
  assert.equal(isExcluded('nightbot', excluded), true);
  assert.equal(isExcluded('someone_else', excluded), false);
});

test('shouldSkipMessage always skips the bot\'s own messages', () => {
  assert.equal(shouldSkipMessage({ self: true, message: 'hello', skipCommands: false }), true);
  assert.equal(shouldSkipMessage({ self: true, message: '!command', skipCommands: false }), true);
});

test('shouldSkipMessage skips "!" commands only when skipCommands is enabled', () => {
  assert.equal(shouldSkipMessage({ self: false, message: '!uptime', skipCommands: true }), true);
  assert.equal(shouldSkipMessage({ self: false, message: '!uptime', skipCommands: false }), false);
});

test('shouldSkipMessage passes through normal chat messages', () => {
  assert.equal(shouldSkipMessage({ self: false, message: 'hello chat', skipCommands: true }), false);
});
