import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'SquadHub',
  description: 'Team collaboration and project management',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
            __html: `(function(){try{var t=localStorage.getItem('squadhub-theme');var p=t?JSON.parse(t):null;var pref=p&&p.state&&p.state.theme?p.state.theme:'auto';var dark=pref==='dark'||(pref==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
