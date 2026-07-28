import type { Metadata } from 'next';
import './globals.css';
import { BRAND, clientEnv } from '@/lib/env/client';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { QueryProvider } from '@/components/providers/query-provider';

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description:
    'Plan cycling and hiking routes on OpenStreetMap data with clear public rights-of-way visualisation, access confidence and GPX export.',
  metadataBase: new URL(clientEnv.NEXT_PUBLIC_APP_URL),
};

const themeScript = `
try {
  var stored = localStorage.getItem('trailloop:theme');
  var dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <QueryProvider>
          <SiteHeader />
          <div id="main" className="flex flex-1 flex-col">
            {children}
          </div>
          <SiteFooter />
        </QueryProvider>
      </body>
    </html>
  );
}
