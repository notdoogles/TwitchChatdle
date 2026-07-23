// Pure header-parsing helper, safe to import from edge middleware (no `pg`
// dependency) as well as from Node.js route handlers.
export interface RequestContext {
  address: string;
  referrer: string;
  userAgent: string;
}

export function getRequestContext(headers: Headers): RequestContext {
  return {
    address: headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
    referrer: headers.get('referer') ?? 'none',
    userAgent: headers.get('user-agent') ?? 'unknown',
  };
}
