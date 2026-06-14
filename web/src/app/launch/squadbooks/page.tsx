'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getFreshAccessToken } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useHasHydrated } from '@/hooks/useHasHydrated';

const SQUADBOOKS_URL =
  process.env.NEXT_PUBLIC_SQUADBOOKS_URL || 'https://books.squadhub.in';

// Only ever hand the token back to the SquadBooks origin — never an arbitrary
// `return` URL (open-redirect / token-leak guard).
function safeReturn(raw: string | null): string {
  const fallback = `${SQUADBOOKS_URL}/sso`;
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    if (u.origin === new URL(SQUADBOOKS_URL).origin) return u.toString();
  } catch {
    /* fall through */
  }
  return fallback;
}

/**
 * Standalone SSO bridge for the SquadBooks login page. SquadBooks sends the user
 * here (same origin as their SquadHub session). If they're signed in, we mint a
 * fresh access token + their active workspace and bounce back to SquadBooks'
 * /sso with the handoff token. If not, we send them through SquadHub login and
 * return here afterwards. Mirrors the in-app sidebar launcher.
 */
export default function LaunchSquadBooks() {
  const router = useRouter();
  const hydrated = useHasHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!hydrated || ran.current) return;

    if (!isAuthenticated) {
      const here = '/launch/squadbooks' + window.location.search;
      router.replace('/login?redirect=' + encodeURIComponent(here));
      return;
    }

    ran.current = true;
    (async () => {
      try {
        const ret = safeReturn(
          new URLSearchParams(window.location.search).get('return'),
        );

        const token = await getFreshAccessToken();
        if (!token) {
          const here = '/launch/squadbooks' + window.location.search;
          router.replace('/login?redirect=' + encodeURIComponent(here));
          return;
        }

        // Use the user's default workspace — same pick the main app makes.
        const res = await api.get('/workspaces');
        const workspaces: Array<{ id: string; name: string }> =
          res.data?.data || [];
        if (workspaces.length === 0) {
          setError('You are not a member of any SquadHub workspace.');
          return;
        }
        const ws = workspaces[0];

        window.location.replace(
          `${ret}#t=${encodeURIComponent(token)}` +
            `&w=${encodeURIComponent(ws.id)}` +
            `&wn=${encodeURIComponent(ws.name)}`,
        );
      } catch (e) {
        setError(
          (e as Error)?.message || 'Could not connect to SquadBooks. Try again.',
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
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 10 }}>
          Squad<span style={{ color: '#0F9F6E' }}>Books</span>
        </div>
        <p style={{ fontSize: 13, color: error ? '#F2555A' : '#8B95A2', margin: 0 }}>
          {error || 'Connecting to SquadBooks…'}
        </p>
      </div>
    </div>
  );
}
