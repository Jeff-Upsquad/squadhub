import type { Metadata } from 'next';
import SidebarStylePreview from './SidebarStylePreview';

export const metadata: Metadata = {
  title: 'Navigation style concepts · SquadHub',
  description: 'Front-end-only A/B preview of SquadHub’s compact icon rail and sidebar.',
};

export default function SidebarPreviewPage() {
  return <SidebarStylePreview />;
}
