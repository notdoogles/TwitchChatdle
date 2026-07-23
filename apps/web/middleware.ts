import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRequestContext } from '@/lib/requestContext';

// Lightweight request observability: this only writes to Vercel's runtime
// logs (not persisted to the DB), scoped to API routes so static asset
// requests don't add noise. See `matcher` below. Persistent logging (for
// longer retention) happens separately in the route handlers themselves,
// since DB access needs the Node.js runtime rather than edge middleware.
export function middleware(request: NextRequest) {
  const { address, referrer, userAgent } = getRequestContext(request.headers);

  console.log('request-observability', {
    address,
    path: request.nextUrl.pathname,
    referrer,
    userAgent,
    at: new Date().toISOString(),
  });

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
