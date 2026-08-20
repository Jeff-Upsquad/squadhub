import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';
import '../styles/mobile.css';
import Providers from './providers';

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
    <html lang="en" suppressHydrationWarning>
      <head>
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
