'use client';

import { useEffect, useState } from 'react';

/**
 * True for the class of errors caused by a stale browser bundle after a deploy
 * — the open tab references chunk hashes the server no longer serves, so the
 * next interaction throws a ChunkLoadError / webpack-runtime error. A one-shot
 * reload pulls the fresh build and the error disappears. This is the most
 * common source of the bare "Application error: a client-side exception"
 * screen on a long-lived admin tab.
 */
export function isStaleBundleError(
  error: { name?: string; message?: string } | null | undefined,
): boolean {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`;
  return (
    error?.name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(text) ||
    /Loading CSS chunk/i.test(text) ||
    /Failed to fetch dynamically imported module/i.test(text) ||
    /error loading dynamically imported module/i.test(text) ||
    /__webpack_modules__\[moduleId\] is not a function/i.test(text)
  );
}

/**
 * Shared fallback rendered by both the route-level (`error.tsx`) and root-level
 * (`global-error.tsx`) error boundaries. Styles are inline on purpose: the
 * global boundary replaces the root layout, so the app stylesheet may not be
 * present when it renders.
 */
export default function AppErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const stale = isStaleBundleError(error);
  const [reloading, setReloading] = useState(stale);

  useEffect(() => {
    if (!stale) return;
    // Guard against a reload loop: only auto-reload once per short window.
    const KEY = 'squadhub-admin-stale-reload';
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY) || '0');
    } catch {
      /* sessionStorage may be unavailable (private mode) — fall through */
    }
    if (Date.now() - last > 8000) {
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      window.location.reload();
    } else {
      // Already reloaded recently and still broken — stop looping, show the UI.
      setReloading(false);
    }
  }, [stale]);

  useEffect(() => {
    // Surface the real error for support/debugging regardless of environment.
    // eslint-disable-next-line no-console
    console.error('[admin] render error boundary caught:', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily:
          'var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#F8FAFC',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: '100%',
          textAlign: 'center',
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 16,
          padding: '32px 28px',
          boxShadow: '0 1px 3px rgba(15,23,43,0.06)',
        }}
      >
        <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 12 }}>⚠️</div>
        {reloading ? (
          <>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0F172B', margin: '0 0 8px' }}>
              Updating to the latest version…
            </h1>
            <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
              A new version was deployed. Reloading now.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0F172B', margin: '0 0 8px' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 20px' }}>
              This screen hit an unexpected error. You can retry, or reload the page.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{
                  padding: '9px 18px',
                  borderRadius: 10,
                  border: '1px solid #E2E8F0',
                  background: '#FFFFFF',
                  color: '#0F172B',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: '9px 18px',
                  borderRadius: 10,
                  border: '1px solid #0F172B',
                  background: '#0F172B',
                  color: '#FFFFFF',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Reload page
              </button>
            </div>
            {error?.digest && (
              <p style={{ fontSize: 11, color: '#94A3B8', margin: '18px 0 0' }}>
                Reference: {error.digest}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
