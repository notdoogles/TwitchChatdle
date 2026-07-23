import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { getGameName } from '@/lib/config';
import SiteFooter from '@/components/SiteFooter';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

// Async so it can read the request's hostname via headers() and resolve a
// per-tenant game name in multi-tenant deployments (see lib/tenants.ts).
export async function generateMetadata(): Promise<Metadata> {
  const gameName = getGameName(headers().get('host'));
  return {
    title: gameName,
    description: 'Guess who sent the chat message.',
  };
}

// Runs before React hydrates so the correct theme is applied on first paint
// (no flash of the wrong theme). Falls back to the browser's system
// preference when the person hasn't chosen light/dark explicitly.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
