import { describe, expect, it } from 'vitest';
import { filterUsernameSuggestions } from './usernameSuggestions';

const HINTS = ['alice', 'Alicia', 'bob', 'malice', 'charlie', 'Bobby'];

describe('filterUsernameSuggestions', () => {
  it('returns nothing for an empty or whitespace-only query', () => {
    expect(filterUsernameSuggestions(HINTS, '')).toEqual([]);
    expect(filterUsernameSuggestions(HINTS, '   ')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    expect(filterUsernameSuggestions(HINTS, 'ALICE')).toEqual(['alice', 'malice']);
  });

  it('ranks prefix matches ahead of mid-string matches', () => {
    // 'alice' starts with the query; 'malice' only contains it.
    expect(filterUsernameSuggestions(HINTS, 'alice')).toEqual(['alice', 'malice']);
  });

  it('preserves original casing of the hints in the output', () => {
    expect(filterUsernameSuggestions(HINTS, 'bob')).toEqual(['bob', 'Bobby']);
  });

  it('caps the number of results at the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => `user${i}`);
    expect(filterUsernameSuggestions(many, 'user', 8)).toHaveLength(8);
  });

  it('drops case-insensitive duplicates so the dropdown has no repeats', () => {
    expect(filterUsernameSuggestions(['Bob', 'bob', 'BOB'], 'bob')).toEqual(['Bob']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterUsernameSuggestions(HINTS, 'zzz')).toEqual([]);
  });
});
