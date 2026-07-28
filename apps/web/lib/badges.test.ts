import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
  pool: { query: vi.fn() },
}));

// Without TWITCH_CLIENT_ID/SECRET configured, getGlobalBadgeSlugs/
// getChannelBadgeSlugs (lib/badgeImages.ts) short-circuit before ever
// calling fetch, but stub it anyway so these tests never make a real
// network call if that assumption changes.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: false }))
);

import { classifyBadges } from './badges';

const CHANNEL = 'somechannel';

describe('classifyBadges', () => {
  it('returns nulls for a chatter with no badges', async () => {
    expect(await classifyBadges(null, CHANNEL)).toEqual({ globalBadge: null, channelBadge: null });
    expect(await classifyBadges(undefined, CHANNEL)).toEqual({ globalBadge: null, channelBadge: null });
    expect(await classifyBadges({}, CHANNEL)).toEqual({ globalBadge: null, channelBadge: null });
  });

  it('classifies a channel-specific badge (moderator)', async () => {
    expect(await classifyBadges({ moderator: '1' }, CHANNEL)).toEqual({
      globalBadge: null,
      channelBadge: 'Moderator',
    });
  });

  it('classifies a channel-specific badge (vip)', async () => {
    expect(await classifyBadges({ vip: '1' }, CHANNEL)).toEqual({ globalBadge: null, channelBadge: 'VIP' });
  });

  it('classifies a channel-specific badge (subscriber)', async () => {
    expect(await classifyBadges({ subscriber: '12' }, CHANNEL)).toEqual({
      globalBadge: null,
      channelBadge: 'Subscriber',
    });
  });

  it('classifies a channel-specific badge (lead_moderator)', async () => {
    expect(await classifyBadges({ lead_moderator: '1' }, CHANNEL)).toEqual({
      globalBadge: null,
      channelBadge: 'Lead Moderator',
    });
  });

  it('classifies a global badge (premium/Prime)', async () => {
    expect(await classifyBadges({ premium: '1' }, CHANNEL)).toEqual({ globalBadge: 'Prime', channelBadge: null });
  });

  it('classifies a global badge (partner)', async () => {
    expect(await classifyBadges({ partner: '1' }, CHANNEL)).toEqual({ globalBadge: 'Partner', channelBadge: null });
  });

  it('classifies a global badge (social-sharing)', async () => {
    expect(await classifyBadges({ 'social-sharing': '3' }, CHANNEL)).toEqual({
      globalBadge: 'Social Sharing',
      channelBadge: null,
    });
  });

  it('picks one representative badge per category by priority when a chatter has several', async () => {
    // moderator outranks subscriber in CHANNEL_PRIORITY.
    expect(await classifyBadges({ subscriber: '6', moderator: '1' }, CHANNEL)).toEqual({
      globalBadge: null,
      channelBadge: 'Moderator',
    });
  });

  it('classifies both a global and a channel badge for the same chatter', async () => {
    expect(await classifyBadges({ vip: '1', premium: '1' }, CHANNEL)).toEqual({
      globalBadge: 'Prime',
      channelBadge: 'VIP',
    });
  });

  it('ignores unrecognized badge slugs when live Helix data is unavailable', async () => {
    // No TWITCH_CLIENT_ID/SECRET configured in tests, so the live Helix
    // fallback lookup can't confirm this slug either way.
    expect(await classifyBadges({ 'some-unknown-badge': '1' }, CHANNEL)).toEqual({
      globalBadge: null,
      channelBadge: null,
    });
  });
});
