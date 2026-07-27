import { describe, expect, it } from 'vitest';
import { classifyBadges } from './badges';

describe('classifyBadges', () => {
  it('returns nulls for a chatter with no badges', () => {
    expect(classifyBadges(null)).toEqual({ globalBadge: null, channelBadge: null });
    expect(classifyBadges(undefined)).toEqual({ globalBadge: null, channelBadge: null });
    expect(classifyBadges({})).toEqual({ globalBadge: null, channelBadge: null });
  });

  it('classifies a channel-specific badge (moderator)', () => {
    expect(classifyBadges({ moderator: '1' })).toEqual({ globalBadge: null, channelBadge: 'Moderator' });
  });

  it('classifies a channel-specific badge (vip)', () => {
    expect(classifyBadges({ vip: '1' })).toEqual({ globalBadge: null, channelBadge: 'VIP' });
  });

  it('classifies a channel-specific badge (subscriber)', () => {
    expect(classifyBadges({ subscriber: '12' })).toEqual({ globalBadge: null, channelBadge: 'Subscriber' });
  });

  it('classifies a global badge (premium/Prime)', () => {
    expect(classifyBadges({ premium: '1' })).toEqual({ globalBadge: 'Prime', channelBadge: null });
  });

  it('classifies a global badge (partner)', () => {
    expect(classifyBadges({ partner: '1' })).toEqual({ globalBadge: 'Partner', channelBadge: null });
  });

  it('picks one representative badge per category by priority when a chatter has several', () => {
    // moderator outranks subscriber in CHANNEL_PRIORITY.
    expect(classifyBadges({ subscriber: '6', moderator: '1' })).toEqual({
      globalBadge: null,
      channelBadge: 'Moderator',
    });
  });

  it('classifies both a global and a channel badge for the same chatter', () => {
    expect(classifyBadges({ vip: '1', premium: '1' })).toEqual({ globalBadge: 'Prime', channelBadge: 'VIP' });
  });

  it('ignores unrecognized badge slugs', () => {
    expect(classifyBadges({ 'some-unknown-badge': '1' })).toEqual({ globalBadge: null, channelBadge: null });
  });
});
