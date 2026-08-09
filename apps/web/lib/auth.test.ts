import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => {
  const mockPool = { query: vi.fn() };
  return {
    pool: mockPool,
    getPool: vi.fn(() => mockPool),
  };
});

import { pool } from './db';
import {
  buildAuthorizeUrl,
  createSession,
  deleteSession,
  exchangeCodeForToken,
  fetchTwitchProfile,
  generateCodeVerifier,
  getSessionUser,
  sha256Base64Url,
  upsertTwitchUser,
} from './auth';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedQuery.mockReset();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('generateCodeVerifier', () => {
  it('returns a url-safe random string', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v.length).toBeGreaterThanOrEqual(32);
  });

  it('produces distinct values across calls', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe('sha256Base64Url', () => {
  it('is the base64url S256 digest of the input', () => {
    expect(sha256Base64Url('hello')).toBe('LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ');
    expect(sha256Base64Url('test-verifier')).toBe('JBbiqONGWPaAmwXk_8bT6UnlPfrn65D32eZlJS-zGG0');
  });
});

describe('buildAuthorizeUrl', () => {
  it('builds an S256 PKCE authorize URL with the expected params', () => {
    const url = new URL(buildAuthorizeUrl('cid123', 'https://example.com/api/auth/callback', 'state-1', 'verifier-x'));
    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/api/auth/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(sha256Base64Url('verifier-x'));
    // No scope is requested -- identifying the user needs none.
    expect(url.searchParams.has('scope')).toBe(false);
  });
});

describe('exchangeCodeForToken', () => {
  it('exchanges the code at the Twitch token endpoint with the PKCE verifier', async () => {
    vi.stubEnv('TWITCH_CLIENT_ID', 'cid');
    vi.stubEnv('TWITCH_CLIENT_SECRET', 'secret');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'at-1' }) }));
    vi.stubGlobal('fetch', fetchMock);

    const { accessToken } = await exchangeCodeForToken('code-1', 'verifier-x', 'https://example.com/api/auth/callback');

    expect(accessToken).toBe('at-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://id.twitch.tv/oauth2/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('secret');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe('https://example.com/api/auth/callback');
    expect(body.get('code_verifier')).toBe('verifier-x');
  });

  it('rejects when the token exchange fails', async () => {
    vi.stubEnv('TWITCH_CLIENT_ID', 'cid');
    vi.stubEnv('TWITCH_CLIENT_SECRET', 'secret');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    await expect(exchangeCodeForToken('code-1', 'v', 'https://example.com/api/auth/callback')).rejects.toThrow(
      /token exchange failed/
    );
  });
});

describe('fetchTwitchProfile', () => {
  it('returns the profile from the Helix users endpoint', async () => {
    vi.stubEnv('TWITCH_CLIENT_ID', 'cid');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: '12345', login: 'coolguy', display_name: 'CoolGuy' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const profile = await fetchTwitchProfile('at-1');
    expect(profile).toEqual({ id: '12345', login: 'coolguy', displayName: 'CoolGuy' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.twitch.tv/helix/users');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
    expect((init.headers as Record<string, string>)['Client-Id']).toBe('cid');
  });

  it('falls back to login when display_name is missing', async () => {
    vi.stubEnv('TWITCH_CLIENT_ID', 'cid');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: '1', login: 'plain' }] }) }))
    );
    await expect(fetchTwitchProfile('at-1')).resolves.toEqual({ id: '1', login: 'plain', displayName: 'plain' });
  });
});

describe('upsertTwitchUser / createSession / deleteSession / getSessionUser', () => {
  it('upserts the users row by twitch_user_id and returns its id', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] });
    const id = await upsertTwitchUser({ id: '12345', login: 'CoolGuy', displayName: 'CoolGuy' });
    expect(id).toBe(7);
    expect(mockedQuery.mock.calls[0][0]).toContain('on conflict (twitch_user_id)');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['12345', 'coolguy', 'CoolGuy']);
  });

  it('creates a session with a fresh token and expiry', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    const sessionId = await createSession(7);
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(10);
    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe(sessionId);
    expect(params[1]).toBe(7);
    expect(params[2] as Date).toBeInstanceOf(Date);
  });

  it('deletes a session by id', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    await deleteSession('sess-1');
    expect(mockedQuery.mock.calls[0][0]).toContain('delete from sessions');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['sess-1']);
  });

  it('returns null without querying when there is no session cookie', async () => {
    await expect(getSessionUser(undefined)).resolves.toBeNull();
    await expect(getSessionUser(null)).resolves.toBeNull();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('returns the display name (falling back to login) for a valid session', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ user_id: 7, username: 'login1', display_name: 'Display Name' }] });
    await expect(getSessionUser('sess-1')).resolves.toEqual({ userId: 7, username: 'Display Name' });

    mockedQuery.mockResolvedValueOnce({ rows: [{ user_id: 7, username: 'login1', display_name: null }] });
    await expect(getSessionUser('sess-1')).resolves.toEqual({ userId: 7, username: 'login1' });
  });

  it('returns null for an unknown or expired session', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getSessionUser('nope')).resolves.toBeNull();
    const [, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe('nope');
    expect(mockedQuery.mock.calls[0][0]).toContain('expires_at > now()');
  });
});
