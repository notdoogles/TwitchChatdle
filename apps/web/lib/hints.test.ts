import { describe, expect, it } from 'vitest';
import { DEFAULT_MASK_LENGTH, maskForHint } from './hints';

describe('maskForHint', () => {
  it('defaults to a fixed-length mask when the length hint has not been revealed', () => {
    expect(maskForHint({})).toBe('?'.repeat(DEFAULT_MASK_LENGTH));
  });

  it('uses the revealed username length once known', () => {
    expect(maskForHint({ usernameLength: 7 })).toBe('???????');
  });

  it('never returns an empty mask, even for a pathological zero length', () => {
    expect(maskForHint({ usernameLength: 0 })).toBe('?');
  });
});
