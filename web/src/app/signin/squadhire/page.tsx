'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

/**
 * Auto-login landing for SquadHire business users.
 *
 * They tapped "Log in via website" on the SquadHub tab inside SquadHire's
 * business portal; SquadHire minted a one-time code and sent them here with it.
 * We hand the code to our own server, which redeems it with SquadHire and
 * returns a real session — the account was created for them when their first
 * card was assigned, so there is nothing to register and no password to type.
 *
 * The mirror of /launch/squadhire, which does this in the other direction for
 * SquadHire's staff portal.
 */
export default function SignInFromSquadHire() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const code = new URLSearchParams(window.location.search).get('code');
      if (!code) {
        setError('This sign-in link is incomplete. Please open SquadHub from SquadHire again.');
        return;
      }

      try {
        const { data: res } = await api.post('/auth/sso/squadhire', { code });
        if (!res?.success) {
          setError('Could not sign you in. Please try again.');
          return;
        }
        setAuth(res.data.user, res.data.access_token, res.data.refresh_token);
        // replace, not push: the code is spent, so back should never re-run it.
        router.replace('/');
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Could not sign you in. Please try again.');
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
            Sign in with a password
          </button>
        )}
      </div>
    </div>
  );
}
