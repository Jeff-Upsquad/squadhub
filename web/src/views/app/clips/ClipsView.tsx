'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CLIPS_URL,
  CLIPS_ORIGIN,
  clipsCurrentTheme,
  useClipsAuthBridge,
} from '../../../hooks/useClipsAuthBridge';

// Squad Clips is a separate app (own repo/deployment) embedded as a mini app.
// This view hosts it full-screen in an iframe; the parent-side auth handshake
// (answering with a guaranteed-fresh access token, pushing rotations/logout) is
// shared with login-gated learning embeds via useClipsAuthBridge.

export default function ClipsView() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [connected, setConnected] = useState(false);

  const { sendAuth } = useClipsAuthBridge(iframeRef, () => setConnected(true));

  // Keep the embedded app's theme in lockstep with the shell.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'squadclips:theme', dark: clipsCurrentTheme() === 'dark' },
        CLIPS_ORIGIN,
      );
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative h-full w-full bg-[var(--canvas)]">
      <iframe
        ref={iframeRef}
        src={CLIPS_URL}
        title="Squad Clips"
        className="h-full w-full border-0"
        // display-capture/microphone/camera power any future in-iframe capture;
        // the recorder itself opens as a popup (top-level) for reliability.
        // picture-in-picture lets a playing clip pop out into a floating window
        // (Permissions Policy must be delegated by this parent frame, else the
        // embedded app sees document.pictureInPictureEnabled === false).
        allow="display-capture; microphone; camera; clipboard-write; autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        onLoad={() => void sendAuth()}
      />
      {!connected && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--canvas)]">
          <div className="flex flex-col items-center gap-2 text-[var(--sh-ink-3)]">
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
              <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span className="text-[13px]">Loading Squad Clips…</span>
          </div>
        </div>
      )}
    </div>
  );
}
