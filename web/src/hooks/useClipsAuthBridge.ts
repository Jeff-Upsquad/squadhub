'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getFreshAccessToken } from '../services/api';

// Squad Clips is a separate app/deployment embedded via <iframe>. This is the
// PARENT side of its postMessage auth handshake: we answer the iframe's
// 'squadclips:ready' / 'squadclips:request-token' with a guaranteed-fresh
// ACCESS token (never the refresh token — Supabase refresh tokens rotate and
// concurrent use from two apps would invalidate the session) and push rotated
// tokens / logout proactively. Protocol lives in the squad-clips repo
// (src/lib/auth-bridge.ts). Used by the full Clips mini app (ClipsView) and by
// login-gated clip embeds inside learning content (VideoEmbedBlock).
export const CLIPS_URL =
  process.env.NEXT_PUBLIC_CLIPS_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://clips.squadhub.in' : 'http://localhost:3200');
export const CLIPS_ORIGIN = new URL(CLIPS_URL).origin;

export function clipsCurrentTheme(): 'light' | 'dark' {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light';
}

export function useClipsAuthBridge(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  onReady?: () => void,
): { sendAuth: () => Promise<void> } {
  // Keep onReady current without re-subscribing the message listener.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

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
        theme: clipsCurrentTheme(),
      },
      CLIPS_ORIGIN,
    );
  }, [iframeRef]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== CLIPS_ORIGIN || e.source !== iframeRef.current?.contentWindow) return;
      const type = e.data?.type;
      if (type === 'squadclips:ready') {
        onReadyRef.current?.();
        void sendAuth();
      } else if (type === 'squadclips:request-token') {
        void sendAuth();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sendAuth, iframeRef]);

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
  }, [sendAuth, iframeRef]);

  return { sendAuth };
}
