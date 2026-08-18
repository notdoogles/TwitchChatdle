import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => {
  const mockPool = { query: vi.fn() };
  return {
    pool: mockPool,
    getPool: vi.fn(() => mockPool),
  };
});

import { pool } from './db';
import { bucketColor, classifyBadgeSlug, emoteImageUrl, getChannelStats } from './stats';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('bucketColor', () => {
  it('maps null/empty to the Twitch default color', () => {
    expect(bucketColor(null)).toEqual({ label: 'Default', hex: '#efeff1' });
    expect(bucketColor(undefined)).toEqual({ label: 'Default', hex: '#efeff1' });
    expect(bucketColor('')).toEqual({ label: 'Default', hex: '#efeff1' });
  });

  it('maps each hue band to its broad bucket', () => {
    expect(bucketColor('#ff0000').label).toBe('Red');
    expect(bucketColor('#ff7f00').label).toBe('Orange');
    expect(bucketColor('#ffd700').label).toBe('Yellow');
    expect(bucketColor('#00c853').label).toBe('Green');
    expect(bucketColor('#00b8b8').label).toBe('Teal');
    expect(bucketColor('#2979ff').label).toBe('Blue');
    expect(bucketColor('#9147ff').label).toBe('Purple');
    expect(bucketColor('#ff69b4').label).toBe('Pink');
  });

  it('is case-insensitive and accepts 3-digit hex', () => {
    expect(bucketColor('#FF0000').label).toBe('Red');
    expect(bucketColor('#fff').label).toBe('White');
  });

  it('maps achromatic colors to white/grey/black', () => {
    expect(bucketColor('#ffffff').label).toBe('White');
    expect(bucketColor('#9e9e9e').label).toBe('Grey');
    expect(bucketColor('#000000').label).toBe('Black');
  });

  it('falls back to Other for malformed values', () => {
    expect(bucketColor('notacolor').label).toBe('Other');
    expect(bucketColor('#zzzzzz').label).toBe('Other');
  });
});

describe('classifyBadgeSlug', () => {
  it('classifies channel-specific badges', () => {
    expect(classifyBadgeSlug('subscriber')).toEqual({ category: 'channel', label: 'Subscriber' });
    expect(classifyBadgeSlug('moderator')).toEqual({ category: 'channel', label: 'Moderator' });
  });

  it('classifies global badges', () => {
    expect(classifyBadgeSlug('partner')).toEqual({ category: 'global', label: 'Partner' });
    expect(classifyBadgeSlug('premium')).toEqual({ category: 'global', label: 'Prime' });
  });

  it('returns null for unrecognized slugs', () => {
    expect(classifyBadgeSlug('unknown_slug')).toBeNull();
  });
});

describe('emoteImageUrl', () => {
  it('builds the Twitch emoticon CDN URL from the emote id', () => {
    expect(emoteImageUrl('25')).toBe('https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0');
  });
});

describe('getChannelStats', () => {
  it('queries all six aggregations for the channel and assembles the response', async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('count(distinct m.id)')) {
        return {
          rows: [
            {
              total_messages: 100,
              total_chatters: 20,
              total_emote_uses: 50,
              first_message_at: '2026-01-01T00:00:00Z',
              last_message_at: '2026-08-18T00:00:00Z',
            },
          ],
        };
      }
      if (sql.includes('group by u.id')) {
        return { rows: [{ username: 'Alice', message_count: 30 }, { username: 'Bob', message_count: 20 }] };
      }
      if (sql.includes("e->>'id'")) {
        return { rows: [{ id: '25', code: 'Kappa', count: 40 }, { id: '1902', code: 'PogChamp', count: 10 }] };
      }
      if (sql.includes('regexp_split_to_table')) {
        return { rows: [{ word: 'pog', count: 15 }, { word: 'watching', count: 12 }] };
      }
      if (sql.includes('coalesce(color')) {
        return {
          rows: [
            { color: '#FF0000', chatter_count: 5 },
            { color: '#ff0000', chatter_count: 2 },
            { color: '#2979ff', chatter_count: 4 },
            { color: '', chatter_count: 6 },
          ],
        };
      }
      if (sql.includes('jsonb_each_text')) {
        return {
          rows: [
            { slug: 'subscriber', chatter_count: 8 },
            { slug: 'moderator', chatter_count: 2 },
            { slug: 'partner', chatter_count: 3 },
            { slug: 'turbo', chatter_count: 1 },
            { slug: 'unknown_slug', chatter_count: 9 },
          ],
        };
      }
      throw new Error(`Unexpected query in test: ${sql}`);
    });

    const stats = await getChannelStats('somechannel');

    expect(stats.overview).toEqual({
      totalMessages: 100,
      totalChatters: 20,
      totalEmoteUses: 50,
      firstMessageAt: '2026-01-01T00:00:00Z',
      lastMessageAt: '2026-08-18T00:00:00Z',
    });
    expect(stats.topChatters).toEqual([
      { username: 'Alice', messageCount: 30 },
      { username: 'Bob', messageCount: 20 },
    ]);
    expect(stats.topEmotes).toEqual([
      { id: '25', code: 'Kappa', count: 40, imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0' },
      { id: '1902', code: 'PogChamp', count: 10, imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/1902/default/dark/2.0' },
    ]);
    expect(stats.wordCloud).toEqual([
      { word: 'pog', count: 15 },
      { word: 'watching', count: 12 },
    ]);
    expect(stats.topColors).toEqual([
      { label: 'Red', hex: '#ff0000', count: 7 },
      { label: 'Default', hex: '#efeff1', count: 6 },
      { label: 'Blue', hex: '#2979ff', count: 4 },
    ]);
    expect(stats.topChannelBadges).toEqual([
      { slug: 'subscriber', label: 'Subscriber', count: 8 },
      { slug: 'moderator', label: 'Moderator', count: 2 },
    ]);
    expect(stats.topGlobalBadges).toEqual([
      { slug: 'partner', label: 'Partner', count: 3 },
      { slug: 'turbo', label: 'Turbo', count: 1 },
    ]);

    expect(mockedQuery).toHaveBeenCalledTimes(6);
    for (const [sql, params] of mockedQuery.mock.calls) {
      const channelFilter =
        sql.includes('where m.channel = $1') ||
        sql.includes('where channel = $1') ||
        sql.includes('where ucs.channel = $1');
      expect(channelFilter).toBe(true);
      expect(params).toEqual(['somechannel']);
    }
  });

  it('returns empty sections when the channel has no data', async () => {
    mockedQuery.mockResolvedValue({ rows: [] });
    const stats = await getChannelStats('emptychannel');

    expect(stats.overview).toEqual({
      totalMessages: 0,
      totalChatters: 0,
      totalEmoteUses: 0,
      firstMessageAt: null,
      lastMessageAt: null,
    });
    expect(stats.topChatters).toEqual([]);
    expect(stats.topEmotes).toEqual([]);
    expect(stats.wordCloud).toEqual([]);
    expect(stats.topColors).toEqual([]);
    expect(stats.topChannelBadges).toEqual([]);
    expect(stats.topGlobalBadges).toEqual([]);
  });
});
