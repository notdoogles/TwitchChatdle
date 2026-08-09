import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  PKCE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  exchangeCodeForToken,
  fetchTwitchProfile,
  upsertTwitchUser,
} from '@/lib/auth';
import { resolveHost } from '@/lib/previewTenant';

export const dynamic = 'force-dynamic';

// Finishes an SSO flow started by /api/auth/login: exchanges the code for a
// token, resolves the player's Twitch profile, links it to their users row
// (via twitch_user_id), and drops a session cookie. Any failure -- missing/
// mismatched PKCE state, Twitch errors, a denied consent -- just lands back
// on the home page signed out.
export async function GET(req: Request) {
  const host = resolveHost(req.headers);
  const url = new URL(req.url);
  const origin = url.origin;
  const home = NextResponse.redirect(origin + '/');

  // The PKCE cookie is single-use, cleared no matter how the flow ends.
  home.cookies.set(PKCE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https'),
    path: '/',
    maxAge: 0,
  });

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code || error) {
    // Twitch bounced the login back with an error (e.g. redirect_mismatch).
    // Log it so the failing redirect_uri (see /api/auth/login's
    // `twitch-login` line) can be matched against the app's registered
    // redirect URLs.
    if (error) {
      console.error('twitch-login rejected by Twitch', { error, description: url.searchParams.get('error_description') });
    }
    return home;
  }

  // Bind this callback to the flow this browser actually started (verifier
  // + state), so a forged callback can't mint a session for an attacker.
  let stored: { verifier: string; state: string } | null = null;
  try {
    const raw = cookies().get(PKCE_COOKIE)?.value;
    if (raw) stored = JSON.parse(raw) as { verifier: string; state: string };
  } catch {
    stored = null;
  }
  if (!stored || stored.state !== state) return home;

  try {
    const { accessToken } = await exchangeCodeForToken(code, stored.verifier, `${origin}/api/auth/callback`);
    const profile = await fetchTwitchProfile(accessToken);
    const userId = await upsertTwitchUser(profile, host);
    const sessionId = await createSession(userId, host);
    home.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https'),
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
  } catch (err) {
    console.error('Twitch SSO callback failed:', err instanceof Error ? err.message : err);
  }
  return home;
}
