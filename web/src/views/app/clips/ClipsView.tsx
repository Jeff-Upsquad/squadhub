'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { getFreshAccessToken } from '../../../services/api';

// Squad Clips is a separate app (own repo/deployment) embedded as a mini app.
// This view hosts it in an iframe and answers its postMessage handshake with a
// guaranteed-fresh ACCESS token — never the refresh token: Supabase refresh
// tokens rotate, and concurrent use from two apps would invalidate this
// session. Protocol details live in the squad-clips repo (src/lib/auth-bridge.ts).
const CLIPS_URL =
  process.env.NEXT_PUBLIC_CLIPS_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://clips.squadhub.in' : 'http://localhost:3200');
const CLIPS_ORIGIN = new URL(CLIPS_URL).origin;

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export default function ClipsView() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [connected, setConnected] = useState(false);

  const sendAuth = useCallback(async () => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    const token = await getFreshAccessToken();
    const { user } = useAuthStore.getState();
    if (!token || !user) return;
    frame.postMessage(
      {
        type: 'squadclips:auth',
        accessToken: token,
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          avatar_url: user.avatar_url,
        },
        theme: currentTheme(),
      },
      CLIPS_ORIGIN,
    );
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== CLIPS_ORIGIN || e.source !== iframeRef.current?.contentWindow) return;
      const type = e.data?.type;
      if (type === 'squadclips:ready') {
        setConnected(true);
        void sendAuth();
      } else if (type === 'squadclips:request-token') {
        void sendAuth();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sendAuth]);

  // Push rotated tokens and logout without waiting to be asked.
  useEffect(() => {
    return useAuthStore.subscribe((state, prev) => {
      const frame = iframeRef.current?.contentWindow;
      if (!frame) return;
      if (state.accessToken && state.accessToken !== prev.accessToken) {
        void sendAuth();
      } else if (!state.isAuthenticated && prev.isAuthenticated) {
        frame.postMessage({ type: 'squadclips:logout' }, CLIPS_ORIGIN);
      }
    });
  }, [sendAuth]);

  // Keep the embedded app's theme in lockstep with the shell.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'squadclips:theme', dark: currentTheme() === 'dark' },
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
