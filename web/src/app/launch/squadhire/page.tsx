'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getFreshAccessToken } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useHasHydrated } from '@/hooks/useHasHydrated';

/**
 * "Sign in with SquadHub" authorize bridge for SquadHire's /staff portal.
 *
 * SquadHire sends the user here (same origin as their SquadHub session) with
 * ?redirect_uri=<squadhire callback>&state=<csrf>. If signed in and eligible,
 * the backend mints a one-time code and returns the redirect URL back to
 * SquadHire (code + state in the query). If not signed in, we route through
 * SquadHub login and return here. The password never leaves SquadHub, and the
 * code — not a token — is what crosses to SquadHire. Mirrors /launch/squadbooks.
 */
export default function LaunchSquadHire() {
  const router = useRouter();
  const hydrated = useHasHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!hydrated || ran.current) return;

    if (!isAuthenticated) {
      const here = '/launch/squadhire' + window.location.search;
      router.replace('/login?redirect=' + encodeURIComponent(here));
      return;
    }

    ran.current = true;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const redirectUri = params.get('redirect_uri');
        const state = params.get('state');
        if (!redirectUri || !state) {
          setError('This sign-in link is incomplete. Please start again from the SquadHire staff page.');
          return;
        }

        const token = await getFreshAccessToken();
        if (!token) {
          const here = '/launch/squadhire' + window.location.search;
          router.replace('/login?redirect=' + encodeURIComponent(here));
          return;
        }

        const res = await api.post('/sso/squadhire/authorize', {
          redirect_uri: redirectUri,
          state,
        });
        const redirect = res.data?.redirect as string | undefined;
        if (!redirect) {
          setError('Could not complete sign-in. Please try again.');
          return;
        }
        window.location.replace(redirect);
      } catch (e: any) {
        // 403 = account type not allowed; other = transient/misconfig.
        setError(
          e?.response?.data?.error ||
            (e as Error)?.message ||
            'Could not connect to SquadHire. Please try again.',
        );
      }
    })();
  }, [hydrated, isAuthenticated, router]);

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
          Squad<span style={{ color: '#6366F1' }}>Hire</span>
        </div>
        <p style={{ fontSize: 13, color: error ? '#F2555A' : '#8B95A2', margin: 0, lineHeight: 1.5 }}>
          {error || 'Connecting you to SquadHire…'}
        </p>
      </div>
    </div>
  );
}
