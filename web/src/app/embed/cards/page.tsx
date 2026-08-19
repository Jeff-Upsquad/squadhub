'use client';

/**
 * Embed shell for the Requirement Cards module inside Squad CRM.
 *
 * Same idea as /embed/crm-chat: CRM frames the real module rather than growing
 * a second copy of it, so a card opened from CRM is the same card, read live
 * from the Hub, with every action (publish, broadcast, assign, owners, offers)
 * behaving exactly as it does in the admin panel. Nothing is mirrored into CRM.
 *
 * Auth is handed in by the CRM parent over postMessage — CRM and the Hub share
 * one Supabase project, so the CRM user's own access token is what the Hub API
 * authorises, and every endpoint under the module stays gated by
 * requireMiniAppOrAdmin('leads').
 *
 * Protocol (parent = CRM, child = this page):
 *   child → parent: { type: 'sh-cards:ready' }
 *   parent → child: { type: 'sh-cards:auth', accessToken, refreshToken?, user? }
 *   child → parent: { type: 'sh-cards:ready-to-use' } | { type: 'sh-cards:error', message }
 *   child → parent: { type: 'sh-cards:card', cardId } whenever the open card changes
 *   parent → child: { type: 'sh-cards:theme', theme: 'dark' | 'light' } on toggle
 *
 * Query params:
 *   crmLeadId / crmDealId / crmContactId — scope to one customer's cards
 *   submissionId                        — same, by Hub submission
 *   title                               — heading shown above the tabs
 *   theme                               — dark | light, the host app's theme
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import axios from 'axios';
import type { User } from '@squadhub/shared';
import { useAuthStore } from '../../../stores/authStore';
import ToastContainer from '../../../components/Toast';
import CardsHub from '@/views/admin/CardsHub';
import type { CardScope } from '@/views/admin/cardScope';

const ALLOWED_PARENT_ORIGINS = [
  process.env.NEXT_PUBLIC_CRM_URL || 'https://crm.squadhub.in',
  'http://localhost:3100',
  'http://127.0.0.1:3100',
].map((u) => {
  try {
    return new URL(u).origin;
  } catch {
    return u;
  }
});

function parentOriginOk(origin: string) {
  return ALLOWED_PARENT_ORIGINS.includes(origin);
}

function EmbedCardsInner() {
  const params = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [status, setStatus] = useState<'waiting' | 'loading' | 'ready' | 'error'>('waiting');
  const [error, setError] = useState('');

  const title = params.get('title') || 'Requirement Cards';
  const scope: CardScope | null = useMemo(() => {
    const next: CardScope = {
      crmLeadId: params.get('crmLeadId'),
      crmDealId: params.get('crmDealId'),
      crmContactId: params.get('crmContactId'),
      submissionId: params.get('submissionId'),
    };
    return next.crmLeadId || next.crmDealId || next.crmContactId || next.submissionId
      ? next
      : null;
  }, [params]);

  const postParent = useCallback((payload: Record<string, unknown>) => {
    if (typeof window === 'undefined' || !window.parent || window.parent === window) return;
    for (const origin of ALLOWED_PARENT_ORIGINS) {
      try {
        window.parent.postMessage(payload, origin);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    postParent({ type: 'sh-cards:ready' });
  }, [postParent]);

  useEffect(() => {
    async function applyAuth(data: { accessToken?: string; refreshToken?: string; user?: User }) {
      if (!data.accessToken) {
        setStatus('error');
        setError('Missing access token');
        postParent({ type: 'sh-cards:error', message: 'Missing access token' });
        return;
      }
      setStatus('loading');
      try {
        let user = data.user;
        if (!user) {
          const res = await axios.get('/users/me', {
            headers: { Authorization: `Bearer ${data.accessToken}` },
          });
          user = res.data?.data as User;
        }
        if (!user) throw new Error('Could not load user profile');

        setAuth(user, data.accessToken, data.refreshToken || data.accessToken);
        setStatus('ready');
        postParent({ type: 'sh-cards:ready-to-use' });
      } catch (err) {
        const message =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          (err instanceof Error ? err.message : 'Auth failed');
        setStatus('error');
        setError(message);
        postParent({ type: 'sh-cards:error', message });
      }
    }

    function onMessage(e: MessageEvent) {
      if (!parentOriginOk(e.origin)) return;
      if (e.data?.type === 'sh-cards:auth') {
        void applyAuth(e.data);
        return;
      }
      // The host toggled its theme. The initial value rides in on ?theme=
      // (ThemeProvider and the anti-flicker script both read it); this only
      // has to handle the change, so it sets the class directly rather than
      // reloading the frame and losing the open card.
      if (e.data?.type === 'sh-cards:theme') {
        const next = e.data.theme;
        if (next === 'dark' || next === 'light') {
          document.documentElement.classList.toggle('dark', next === 'dark');
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postParent, setAuth]);

  // Tell CRM which card is open so its panel header can follow along (and so a
  // deep link back into the Hub admin can be offered).
  const openCardId = params.get('card');
  useEffect(() => {
    if (status !== 'ready') return;
    postParent({ type: 'sh-cards:card', cardId: openCardId || null });
  }, [openCardId, postParent, status]);

  if (status !== 'ready') {
    return (
      <div className="flex h-screen items-center justify-center sh-surface px-6 text-center">
        <p className="text-[13px] text-[var(--color-sh-ink-3)]">
          {status === 'error' ? error || 'Could not load cards' : 'Loading cards…'}
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden sh-surface">
      <CardsHub title={title} scope={scope} />
      {/* MainLayout normally mounts this; the embed has no layout of its own and
          the shared modules toast on every action. */}
      <ToastContainer />
    </div>
  );
}

export default function EmbedCardsPage() {
  return (
    <Suspense fallback={null}>
      <EmbedCardsInner />
    </Suspense>
  );
}
