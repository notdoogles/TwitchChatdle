import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { deleteSession, SESSION_COOKIE } from '@/lib/auth';
import { resolveHost } from '@/lib/previewTenant';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const host = resolveHost(req.headers);
  const origin = new URL(req.url).origin;

  const sessionId = cookies().get(SESSION_COOKIE)?.value;
  if (sessionId) {
    try {
      await deleteSession(sessionId, host);
    } catch (err) {
      console.error('Failed to delete session:', err instanceof Error ? err.message : err);
    }
  }

  const res = NextResponse.redirect(origin + '/');
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https'),
    path: '/',
    maxAge: 0,
  });
  return res;
}
