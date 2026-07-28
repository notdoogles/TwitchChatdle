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

import { classifyAllBadges } from './badges';

const CHANNEL = 'somechannel';

describe('classifyAllBadges', () => {
  it('returns empty lists for a chatter with no badges', async () => {
    expect(await classifyAllBadges(null, CHANNEL)).toEqual({ globalBadges: [], channelBadges: [] });
    expect(await classifyAllBadges(undefined, CHANNEL)).toEqual({ globalBadges: [], channelBadges: [] });
    expect(await classifyAllBadges({}, CHANNEL)).toEqual({ globalBadges: [], channelBadges: [] });
  });

  it('classifies a channel-specific badge (moderator)', async () => {
    expect(await classifyAllBadges({ moderator: '1' }, CHANNEL)).toEqual({
      globalBadges: [],
      channelBadges: [{ slug: 'moderator', version: '1', label: 'Moderator' }],
    });
  });

  it('classifies a channel-specific badge (vip)', async () => {
    expect(await classifyAllBadges({ vip: '1' }, CHANNEL)).toEqual({
      globalBadges: [],
      channelBadges: [{ slug: 'vip', version: '1', label: 'VIP' }],
    });
  });

  it('classifies a channel-specific badge (subscriber)', async () => {
    expect(await classifyAllBadges({ subscriber: '12' }, CHANNEL)).toEqual({
      globalBadges: [],
      channelBadges: [{ slug: 'subscriber', version: '12', label: 'Subscriber' }],
    });
  });

  it('classifies a channel-specific badge (lead_moderator)', async () => {
    expect(await classifyAllBadges({ lead_moderator: '1' }, CHANNEL)).toEqual({
      globalBadges: [],
      channelBadges: [{ slug: 'lead_moderator', version: '1', label: 'Lead Moderator' }],
    });
  });

  it('classifies a global badge (premium/Prime)', async () => {
    expect(await classifyAllBadges({ premium: '1' }, CHANNEL)).toEqual({
      globalBadges: [{ slug: 'premium', version: '1', label: 'Prime' }],
      channelBadges: [],
    });
  });

  it('classifies a global badge (partner)', async () => {
    expect(await classifyAllBadges({ partner: '1' }, CHANNEL)).toEqual({
      globalBadges: [{ slug: 'partner', version: '1', label: 'Partner' }],
      channelBadges: [],
    });
  });

  it('classifies a global badge (social-sharing)', async () => {
    expect(await classifyAllBadges({ 'social-sharing': '3' }, CHANNEL)).toEqual({
      globalBadges: [{ slug: 'social-sharing', version: '3', label: 'Social Sharing' }],
      channelBadges: [],
    });
  });

  it('returns every badge in a category, not just one representative', async () => {
    expect(await classifyAllBadges({ subscriber: '6', moderator: '1' }, CHANNEL)).toEqual({
      globalBadges: [],
      channelBadges: [
        { slug: 'subscriber', version: '6', label: 'Subscriber' },
        { slug: 'moderator', version: '1', label: 'Moderator' },
      ],
    });
  });

  it('classifies both global and channel badges for the same chatter', async () => {
    expect(await classifyAllBadges({ vip: '1', premium: '1' }, CHANNEL)).toEqual({
      globalBadges: [{ slug: 'premium', version: '1', label: 'Prime' }],
      channelBadges: [{ slug: 'vip', version: '1', label: 'VIP' }],
    });
  });

  it('handles a chatter with all three badges from the reported bug (subscriber, lead_moderator, social-sharing)', async () => {
    expect(
      await classifyAllBadges({ subscriber: '12', lead_moderator: '1', 'social-sharing': '3' }, CHANNEL)
    ).toEqual({
      globalBadges: [{ slug: 'social-sharing', version: '3', label: 'Social Sharing' }],
      channelBadges: [
        { slug: 'subscriber', version: '12', label: 'Subscriber' },
        { slug: 'lead_moderator', version: '1', label: 'Lead Moderator' },
      ],
    });
  });

  it('ignores unrecognized badge slugs when live Helix data is unavailable', async () => {
    // No TWITCH_CLIENT_ID/SECRET configured in tests, so the live Helix
    // fallback lookup can't confirm this slug either way.
    expect(await classifyAllBadges({ 'some-unknown-badge': '1' }, CHANNEL)).toEqual({
      globalBadges: [],
      channelBadges: [],
    });
  });
});
