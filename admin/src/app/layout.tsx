import type { Metadata } from 'next';
import '../styles/globals.css';
import Providers from './providers';
import ToastContainer from '@/components/Toast';

export const metadata: Metadata = {
  title: 'SquadHub Admin',
  description: 'SquadHub Admin Panel',
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
        <ToastContainer />
      </body>
    </html>
  );
}
