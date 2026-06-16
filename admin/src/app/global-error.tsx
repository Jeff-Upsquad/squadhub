'use client';

// Root-level error boundary: the last line of defense for errors thrown in the
// root layout itself. It replaces the entire document, so it renders its own
// <html>/<body>. Shares the recoverable screen with the route-level boundary.
import AppErrorScreen from '@/components/AppErrorScreen';

export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <AppErrorScreen {...props} />
      </body>
    </html>
  );
}
