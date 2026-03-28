import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "We're Hiring | UpSquad",
  description: 'Join the UpSquad team — open positions for Designers, Video Editors, and more.',
};

export default function HiringLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
