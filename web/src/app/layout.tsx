import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, Inter } from 'next/font/google';
import '../styles/globals.css';
import '../styles/mobile.css';
import Providers from './providers';

// Same faces as admin — Requirement Cards (and other shared admin modules)
// use `font-[family-name:var(--font-jakarta)]`. Without next/font those
// variables never resolve to a loaded face and headings fall back to Times.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SquadHub',
  description: 'Team collaboration and project management',
  manifest: '/manifest.json',
  applicationName: 'SquadHub',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'SquadHub' },
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${jakarta.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Hub CSS still hardcodes 'Plus Jakarta Sans' / 'Inter' in many places.
            The old globals.css @import sits after Tailwind and is ignored, so
            load the faces here. next/font above owns --font-jakarta/--font-inter
            for shared admin modules (Requirement Cards). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Anti-flicker: apply dark class before first paint */}
        <script
          dangerouslySetInnerHTML={{
            // `?theme=` wins: embedded surfaces (/embed/*) follow their host
            // app's theme, and reading it here keeps a framed module from
            // flashing light inside a dark host before hydration.
            __html: `(function(){try{var f=new URLSearchParams(location.search).get('theme');if(f==='dark'||f==='light'){document.documentElement.classList.toggle('dark',f==='dark');return;}var t=localStorage.getItem('squadhub-theme');var p=t?JSON.parse(t):null;var pref=p&&p.state&&p.state.theme?p.state.theme:'auto';var dark=pref==='dark'||(pref==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
