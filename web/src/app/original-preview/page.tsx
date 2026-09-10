import type { Metadata } from 'next';
import OriginalPreview from './OriginalPreview';

export const metadata: Metadata = {
  title: 'Original Home · background variants',
  description: 'The real Home design with two background-canvas variants: frosted glass and frosted black.',
};

export default function OriginalPreviewPage() {
  return <OriginalPreview />;
}
