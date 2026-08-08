import crypto from 'crypto';
import { getPool } from './db';
import { getTwitchClientId, getTwitchClientSecret } from './config';

// Twitch SSO via OAuth 2.0 Authorization Code + PKCE (Twitch deprecated the
// implicit flow). Server-side only (imports `pg`), so client components must
// import only the SessionUser type (type-only imports are erased at build).
//
// Twitch app credentials are shared with the badge-image lookups
// (lib/badgeImages.ts): the same TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET app
// does both grants. The redirect URI is derived from the request origin
// (`<origin>/api/auth/callback`), so every hostname the app is served on --
// each tenant domain plus localhost in dev -- must be registered as a
// redirect URI in the Twitch dev console for that app.

export const SESSION_COOKIE = 'chatdle_session';
export const PKCE_COOKIE = 'chatdle_pkce';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  // The users.id of the signed-in player (their chatter identity row).
  userId: number;
  // Display name (falls back to login) shown in the header / leaderboard.
  username: string;
}

export interface TwitchProfile {
  id: string;
  login: string;
  displayName: string;
}

// Opaque random PKCE code_verifier, url-safe so it survives the round trip
// through the code_challenge hash and the token exchange.
export function generateCodeVerifier(): string {
  return crypto.randomBytes(48).toString('base64url');
}

// S256 code_challenge derived from the verifier (PKCE spec: base64url of the
// SHA-256 digest, without padding).
export function sha256Base64Url(input: string): string {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

// The Twitch authorize URL for starting an SSO flow. `scope` is deliberately
// omitted: identifying the signed-in user only needs their own Helix /users
// profile, which requires no scopes.
export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string, verifier: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    code_challenge: sha256Base64Url(verifier),
    code_challenge_method: 'S256',
  });
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

// Exchanges the one-time authorization code for an access token. Called from
// the server (the client secret never leaves it).
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{ accessToken: string }> {
  const clientId = getTwitchClientId();
  const clientSecret = getTwitchClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error('TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET are not configured on the server.');
  }

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error('Twitch token exchange failed.');
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Twitch token exchange returned no access token.');
  return { accessToken: data.access_token };
}

// The signed-in user's Twitch profile (id/login/display_name). `id` is the
// same numeric twitch_user_id the IRC worker keys the users table on, which
// is what links a login to the player's existing chatter identity.
export async function fetchTwitchProfile(accessToken: string): Promise<TwitchProfile> {
  const clientId = getTwitchClientId();
  if (!clientId) throw new Error('TWITCH_CLIENT_ID is not configured on the server.');

  const res = await fetch('https://api.twitch.tv/helix/users', {
    headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId },
  });
  if (!res.ok) throw new Error('Could not fetch Twitch user.');
  const data = (await res.json()) as { data?: { id?: string; login?: string; display_name?: string }[] };
  const user = data.data?.[0];
  if (!user?.id || !user?.login) throw new Error('Twitch returned no user.');
  return { id: user.id, login: user.login, displayName: user.display_name || user.login };
}

// Creates (or refreshes) the users row for a signed-in player and returns
// its id. Same upsert shape the IRC worker uses, so a login never conflicts
// with an existing chatter row for the same twitch_user_id.
export async function upsertTwitchUser(profile: TwitchProfile, host?: string | null): Promise<number> {
  const { rows } = await getPool(host).query<{ id: number }>(
    `insert into users (twitch_user_id, username, display_name)
     values ($1, $2, $3)
     on conflict (twitch_user_id)
     do update set username = excluded.username, display_name = excluded.display_name
     returning id`,
    [profile.id, profile.login.toLowerCase(), profile.displayName]
  );
  return rows[0].id;
}

export async function createSession(userId: number, host?: string | null): Promise<string> {
  const id = crypto.randomBytes(32).toString('base64url');
  await getPool(host).query('insert into sessions (id, user_id, expires_at) values ($1, $2, $3)', [
    id,
    userId,
    new Date(Date.now() + SESSION_TTL_MS),
  ]);
  return id;
}

export async function deleteSession(sessionId: string, host?: string | null): Promise<void> {
  await getPool(host).query('delete from sessions where id = $1', [sessionId]);
}

// Resolves the session cookie to the signed-in player, or null when there is
// no valid (unexpired) session.
export async function getSessionUser(
  sessionId: string | null | undefined,
  host?: string | null
): Promise<SessionUser | null> {
  if (!sessionId) return null;
  const { rows } = await getPool(host).query<{ user_id: number; username: string; display_name: string | null }>(
    `select s.user_id, u.username, u.display_name
     from sessions s
     join users u on u.id = s.user_id
     where s.id = $1 and s.expires_at > now()`,
    [sessionId]
  );
  if (rows.length === 0) return null;
  return { userId: rows[0].user_id, username: rows[0].display_name || rows[0].username };
}
