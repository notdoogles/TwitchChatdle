// Exercises classifyBadges's live-Helix fallback for slugs the static
// CHANNEL_BADGE_LABELS/GLOBAL_BADGE_LABELS lists don't recognize (e.g.
// Twitch badges shipped after those lists were last updated). Kept in a
// separate file from badges.test.ts because it needs TWITCH_CLIENT_ID/
// SECRET configured, which changes the "no live data available" fallback
// behavior the rest of the classifyBadges suite relies on.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>();
  return {
    ...actual,
    getTwitchClientId: () => 'test-client-id',
    getTwitchClientSecret: () => 'test-client-secret',
  };
});

vi.mock('./db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [{ twitch_channel_id: '123' }] })) },
}));

import { classifyBadges } from './badges';

const CHANNEL = 'somechannel';

describe('classifyBadges (live Helix fallback)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('oauth2/token')) {
          return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
        }
        if (url.includes('/chat/badges/global')) {
          return {
            ok: true,
            json: async () => ({
              data: [{ set_id: 'social-sharing', versions: [{ id: '3', image_url_4x: 'https://x/social.png' }] }],
            }),
          };
        }
        if (url.includes('/chat/badges')) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { set_id: 'totally-new-channel-badge', versions: [{ id: '1', image_url_4x: 'https://x/new.png' }] },
              ],
            }),
          };
        }
        return { ok: false };
      })
    );
  });

  it('recognizes an unrecognized-but-live-confirmed global badge (social-sharing)', async () => {
    expect(await classifyBadges({ 'social-sharing': '3' }, CHANNEL)).toEqual({
      globalBadge: 'Social Sharing',
      channelBadge: null,
    });
  });

  it('recognizes an unrecognized-but-live-confirmed channel badge via the channel endpoint', async () => {
    expect(await classifyBadges({ 'totally-new-channel-badge': '1' }, CHANNEL)).toEqual({
      globalBadge: null,
      channelBadge: 'Totally New Channel Badge',
    });
  });
});
