import { describe, expect, it } from 'vitest';
import { isIntelligible, normalizeText } from './textFilters';

describe('normalizeText', () => {
  it('trims and lowercases', () => {
    expect(normalizeText('  Hello World  ')).toBe('hello world');
  });

  it('collapses repeated internal whitespace', () => {
    expect(normalizeText('hello   world\t\tfoo')).toBe('hello world foo');
  });

  it('treats differently-cased/whitespaced text as equal after normalizing', () => {
    expect(normalizeText('Hello   World')).toBe(normalizeText('hello world'));
  });
});

describe('isIntelligible', () => {
  it('rejects messages shorter than the minimum length', () => {
    expect(isIntelligible('short msg')).toBe(false);
  });

  it('rejects bare links', () => {
    expect(isIntelligible('https://example.com/some/long/path/here')).toBe(false);
  });

  it('rejects messages with too few tokens', () => {
    expect(isIntelligible('onereallylongwordthatisstillonetoken')).toBe(false);
  });

  it('accepts a normal, readable sentence', () => {
    expect(isIntelligible('this is a perfectly normal chat message')).toBe(true);
  });

  it('rejects messages that are mostly ALLCAPS emote-like tokens', () => {
    expect(isIntelligible('KEKW LULW OMEGALUL POGGERS')).toBe(false);
  });

  it('rejects messages that are mostly camelCase emote-like tokens', () => {
    expect(isIntelligible('PogChamp monkaS PepeHands biblethump')).toBe(false);
  });

  it('rejects messages that are mostly digit/letter mixes', () => {
    expect(isIntelligible('5Head 4Head 100T PogU')).toBe(false);
  });

  it('respects a custom minLength option', () => {
    expect(isIntelligible('hi there friend', { minLength: 5 })).toBe(true);
    expect(isIntelligible('hi there friend', { minLength: 50 })).toBe(false);
  });

  it('respects a custom minTokens option', () => {
    expect(isIntelligible('just two words', { minTokens: 2 })).toBe(true);
    expect(isIntelligible('just two words', { minTokens: 10 })).toBe(false);
  });

  it('respects a custom minWordRatio option', () => {
    const mixed = 'hello KEKW world LULW friend PogChamp';
    expect(isIntelligible(mixed, { minWordRatio: 0.1 })).toBe(true);
    expect(isIntelligible(mixed, { minWordRatio: 0.9 })).toBe(false);
  });

  it('rejects messages longer than the default maxLength', () => {
    expect(isIntelligible('a '.repeat(300))).toBe(false);
  });

  it('respects a custom maxLength option', () => {
    const text = 'this is a perfectly normal chat message';
    expect(isIntelligible(text, { maxLength: 5 })).toBe(false);
    expect(isIntelligible(text, { maxLength: 100 })).toBe(true);
  });

  it('rejects messages with more tokens than the default maxTokens', () => {
    expect(isIntelligible('word '.repeat(61).trim())).toBe(false);
  });

  it('respects a custom maxTokens option', () => {
    const text = 'this is a perfectly normal chat message';
    expect(isIntelligible(text, { maxTokens: 3 })).toBe(false);
    expect(isIntelligible(text, { maxTokens: 20 })).toBe(true);
  });
});
