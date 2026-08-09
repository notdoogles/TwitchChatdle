import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { buildAuthorizeUrl, generateCodeVerifier, PKCE_COOKIE } from '@/lib/auth';
import { getTwitchClientId } from '@/lib/config';

export const dynamic = 'force-dynamic';

// PKCE code_verifier cookie lifetime: long enough to finish the Twitch
// consent page, short enough that a stale verifier can't linger.
const PKCE_MAX_AGE_SECONDS = 10 * 60;

// Starts an SSO flow: stashes the PKCE verifier (+ a CSRF state) in an
// httpOnly cookie, then bounces the player to Twitch's consent page. The
// redirect URI is derived from the request origin so multi-tenant hostnames
// work without per-host config (each one must be registered in the Twitch
// dev console for the app).
export async function GET(req: Request) {
  const clientId = getTwitchClientId();
  if (!clientId) {
    return NextResponse.json({ error: 'TWITCH_CLIENT_ID is not configured on the server.' }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const verifier = generateCodeVerifier();
  const state = crypto.randomBytes(16).toString('base64url');

  const res = NextResponse.redirect(buildAuthorizeUrl(clientId, `${origin}/api/auth/callback`, state, verifier));
  res.cookies.set(PKCE_COOKIE, JSON.stringify({ verifier, state }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https'),
    path: '/',
    maxAge: PKCE_MAX_AGE_SECONDS,
  });
  return res;
}
