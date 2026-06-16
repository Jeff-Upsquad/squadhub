'use client';

// Route-level error boundary: catches render errors anywhere in the admin app
// subtree and shows a recoverable screen instead of Next's bare
// "Application error: a client-side exception" message.
import AppErrorScreen from '@/components/AppErrorScreen';

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppErrorScreen {...props} />;
}
