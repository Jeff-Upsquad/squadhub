import type { Metadata } from 'next';
import '../styles/globals.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'SquadHub',
  description: 'Team collaboration and project management',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
