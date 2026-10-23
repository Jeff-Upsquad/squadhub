'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { rememberActiveWorkspace } from '@/components/WorkspaceSwitcher';

/**
 * Landing for one-time login links minted by Squad Hub (super-admin "Log in
 * as", staff "Sign in with Squad Hub"). GET /auth/one-time redeemed the link
 * server-side and sent the session here in the URL fragment (never sent to a
 * server). We store it, wipe the fragment, and open the target workspace.
 */
export default function OneTimeSignIn() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    // The tokens must not linger in history or the address bar.
    window.history.replaceState(null, '', window.location.pathname);

    const fail = params.get('error');
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    if (fail || !access || !refresh) {
      setError(fail || 'This sign-in link is incomplete. Please ask for a new one.');
      return;
    }

    (async () => {
      try {
        const res = await axios.get('/users/me', { headers: { Authorization: `Bearer ${access}` } });
        useWorkspaceStore.getState().reset();
        const ws = params.get('workspace_id');
        if (ws) rememberActiveWorkspace(ws);
        setAuth(res.data.data, access, refresh);
        router.replace('/app');
      } catch {
        setError('Could not sign you in. Please ask for a new link.');
      }
    })();
  }, [router, setAuth]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#0E1014',
        color: '#E6EAF0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '24px',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 10 }}>
          Squad<span style={{ color: '#6366F1' }}>Hub</span>
        </div>
        <p style={{ fontSize: 13, color: error ? '#F2555A' : '#8B95A2', margin: 0, lineHeight: 1.5 }}>
          {error || 'Signing you in…'}
        </p>
        {error && (
          <button
            onClick={() => router.replace('/login')}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              borderRadius: 999,
              border: '1px solid #2A2F39',
              background: 'transparent',
              color: '#E6EAF0',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Go to sign in
          </button>
        )}
      </div>
    </div>
  );
}
