import type { Metadata } from 'next';
import SquadHomePreview from './SquadHomePreview';

export const metadata: Metadata = {
  title: 'My home · SquadHub preview',
  description: 'Threads-inspired preview of the SquadHub icon rail, sidebar, and My home.',
};

export default function DesignPreviewPage() {
  return <SquadHomePreview />;
}
