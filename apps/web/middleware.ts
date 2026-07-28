import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRequestContext } from '@/lib/requestContext';
import { PREVIEW_TENANT_COOKIE, PREVIEW_TENANT_HEADER } from '@/lib/previewTenant';

// Lightweight request observability: this only writes to Vercel's runtime
// logs (not persisted to the DB). Persistent logging (for longer retention)
// happens separately in the route handlers themselves, since DB access
// needs the Node.js runtime rather than edge middleware. Only api routes
// are logged so static asset/page requests don't add noise -- see the
// `matcher` below, which (unlike this check) needs to cover page routes
// too for the preview tenant override.
function logApiRequest(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api/')) return;

  const { address, referrer, userAgent } = getRequestContext(request.headers);
  console.log('request-observability', {
    address,
    path: request.nextUrl.pathname,
    referrer,
    userAgent,
    at: new Date().toISOString(),
  });
}

// Lets `?tenant=<hostname>` on a non-production deployment (e.g. a Vercel
// preview build) simulate a production tenant hostname from lib/tenants.ts,
// so a specific tenant can be viewed on a preview URL in a normal browser --
// no real domain/DNS, custom preview suffix, or header-spoofing extension
// needed. Disabled in production so it can never override a live tenant.
function applyPreviewTenantOverride(request: NextRequest): NextResponse {
  if (process.env.VERCEL_ENV === 'production') {
    return NextResponse.next();
  }

  const queryTenant = request.nextUrl.searchParams.get('tenant');
  const tenantHost = queryTenant || request.cookies.get(PREVIEW_TENANT_COOKIE)?.value;
  if (!tenantHost) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PREVIEW_TENANT_HEADER, tenantHost);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Persist via cookie so the override also applies to follow-up requests
  // (e.g. the /api/game/new fetch) that don't repeat the query param.
  if (queryTenant) {
    response.cookies.set(PREVIEW_TENANT_COOKIE, queryTenant, { maxAge: 60 * 60 * 24, sameSite: 'lax' });
  }
  return response;
}

export function middleware(request: NextRequest) {
  logApiRequest(request);
  return applyPreviewTenantOverride(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
