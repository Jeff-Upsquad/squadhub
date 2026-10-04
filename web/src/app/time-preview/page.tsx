import type { Metadata } from 'next';
import OriginalPreview from '../original-preview/OriginalPreview';
export const metadata: Metadata = { title: 'Time overview · SquadHub', description: 'Interactive preview of the My Home time calendar with sample sessions.' };
export default function TimePreviewPage() { return <OriginalPreview timePreview />; }
