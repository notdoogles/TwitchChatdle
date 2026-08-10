// Cookie that records the "don't show this again" choice for the on-load
// announcement modal. Shared by page.tsx (server: skips rendering when set)
// and AnnouncementModal (client: writes it on tick), so it lives in a plain
// module rather than the client component -- Server Components can't read
// non-component exports from a 'use client' module at runtime.
export const ANNOUNCEMENT_COOKIE = 'chatdle_announcement_dismissed';
