import { useEffect, useRef, useState } from 'react';

// Renders an external web page (e.g. a meeting link) inside the app as a tab
// pane. Most links — including our default Jitsi meetings — embed cleanly in an
// iframe. Some providers (Google Meet, Zoom, Teams) send X-Frame-Options / CSP
// `frame-ancestors` headers that BLOCK embedding, so the frame stays blank; for
// those we surface an "Open in browser" fallback both in the toolbar (always)
// and as a centered card once it's clear the frame isn't going to load.

export default function ExternalTabPane({ url, title }: { url: string; title?: string | null }) {
  const [loaded, setLoaded] = useState(false);
  // Reload nonce — bump to force a fresh iframe (and reset the load state).
  const [nonce, setNonce] = useState(0);
  const timerRef = useRef<number | null>(null);

  // If the frame hasn't loaded within a few seconds it's almost certainly being
  // blocked from embedding — show the fallback card over the blank frame.
  const [likelyBlocked, setLikelyBlocked] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setLikelyBlocked(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setLikelyBlocked((prev) => (loaded ? prev : true)), 4000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce]);

  const openExternal = () => window.open(url, '_blank', 'noopener,noreferrer');
  const label = title || (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  return (
    <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden bg-[var(--surface)]">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--sh-hair)] px-3 py-1.5">
        <svg className="h-3.5 w-3.5 shrink-0 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
        </svg>
        <span className="flex-1 truncate text-[12.5px] font-medium text-[var(--sh-ink)]" title={url}>{label}</span>
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          title="Reload"
          className="grid h-[24px] w-[24px] place-items-center rounded-[6px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={openExternal}
          title="Open in your browser"
          className="flex items-center gap-1 rounded-[6px] border border-[var(--sh-hair)] px-2 py-1 text-[11.5px] font-medium text-[var(--sh-ink-2)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
        >
          Open in browser
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </button>
      </div>

      {/* Frame */}
      <div className="relative flex-1 min-h-0">
        <iframe
          key={nonce}
          src={url}
          title={label}
          onLoad={() => { setLoaded(true); setLikelyBlocked(false); }}
          className="h-full w-full border-0"
          allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
        />
        {likelyBlocked && !loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--surface)] px-6 text-center">
            <div className="text-[var(--sh-ink-4)]">
              <svg className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
              </svg>
            </div>
            <p className="max-w-xs text-[13px] text-[var(--sh-ink-2)]">
              This link can't be shown inside the app. Some providers (like Google Meet and Zoom) don't allow embedding.
            </p>
            <button
              type="button"
              onClick={openExternal}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--sh-ink)] px-4 py-2 text-[13px] font-medium text-[var(--surface)] transition hover:opacity-90"
            >
              Open in browser
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
