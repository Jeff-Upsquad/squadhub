'use client';

/**
 * Minimal shell for embedding the real SquadHub ChatPanel inside CRM.
 * Auth is handed in via postMessage from the CRM parent (shared Supabase JWT).
 *
 * Protocol (parent = CRM, child = this page):
 *   child → parent: { type: 'crm-chat:ready' }
 *   parent → child: { type: 'crm-chat:auth', accessToken, refreshToken?, user? }
 *   child → parent: { type: 'crm-chat:ready-to-chat' } | { type: 'crm-chat:error', message }
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import axios from 'axios';
import type { Channel, User } from '@squadhub/shared';
import { useAuthStore } from '../../../stores/authStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { connectSocket } from '../../../services/socket';
import { useChannelMembers } from '../../../hooks/useChannelMembers';
import ChatPanel from '../../../views/app/chat/ChatPanel';

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

function EmbedCrmChatInner() {
  const params = useSearchParams();
  const channelId = params.get('channelId') || '';
  const channelName = params.get('name') || 'crm-chat';
  const channelLabel = params.get('label') || null;
  const workspaceIdParam = params.get('workspaceId') || 'embed';
  const setAuth = useAuthStore((s) => s.setAuth);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const meId = useAuthStore((s) => s.user?.id);
  const setChannels = useWorkspaceStore((s) => s.setChannels);
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const [status, setStatus] = useState<'waiting' | 'loading' | 'ready' | 'error'>('waiting');
  const [error, setError] = useState('');

  // "You're the only one here" guard: enabled when no other members are in the
  // channel yet, so sending prompts the user to @mention a teammate.
  const { data: members = [] } = useChannelMembers(
    status === 'ready' && channelId ? channelId : null,
  );
  const soloGuard = members.length > 0 && members.every((m) => m.id === meId);

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
    postParent({ type: 'crm-chat:ready' });
  }, [postParent]);

  useEffect(() => {
    async function applyAuth(data: {
      accessToken?: string;
      refreshToken?: string;
      user?: User;
      workspaceId?: string;
    }) {
      if (!data.accessToken) {
        setStatus('error');
        setError('Missing access token');
        postParent({ type: 'crm-chat:error', message: 'Missing access token' });
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
        connectSocket();

        if (channelId) {
          const seed: Channel = {
            id: channelId,
            workspace_id: data.workspaceId || workspaceIdParam,
            name: channelName,
            description: channelLabel,
            is_private: true,
            created_by: user.id,
            created_at: new Date().toISOString(),
          };
          setChannels([seed]);
          setWorkspace({
            id: data.workspaceId || workspaceIdParam,
            name: 'CRM',
            slug: 'crm',
            owner_id: user.id,
            created_at: new Date().toISOString(),
          });
        }

        setStatus('ready');
        postParent({ type: 'crm-chat:ready-to-chat' });
      } catch (err) {
        const message =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          (err instanceof Error ? err.message : 'Auth failed');
        setStatus('error');
        setError(message);
        postParent({ type: 'crm-chat:error', message });
      }
    }

    function onMessage(e: MessageEvent) {
      if (!parentOriginOk(e.origin)) return;
      if (e.data?.type === 'crm-chat:auth') {
        void applyAuth(e.data);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    channelId,
    channelName,
    channelLabel,
    workspaceIdParam,
    setAuth,
    setChannels,
    setWorkspace,
    postParent,
  ]);

  const body = useMemo(() => {
    if (!channelId) {
      return (
        <div className="grid h-full place-items-center p-6 text-sm text-foreground-muted">
          Missing channelId
        </div>
      );
    }
    if (status === 'error') {
      return (
        <div className="grid h-full place-items-center p-6 text-center text-sm text-red-600">
          {error || 'Could not load chat'}
        </div>
      );
    }
    if (status !== 'ready' || !isAuthenticated) {
      return (
        <div className="grid h-full place-items-center p-6 text-sm text-foreground-muted">
          Connecting to SquadHub chat…
        </div>
      );
    }
    return (
      <div className="squadhub-chat flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <ChatPanel channelId={channelId} kind="channel" soloGuard={soloGuard} />
      </div>
    );
  }, [channelId, status, error, isAuthenticated, soloGuard]);

  return (
    <div className="flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-surface text-foreground">
      {body}
    </div>
  );
}

export default function EmbedCrmChatPage() {
  return (
    <Suspense
      fallback={
        <div className="grid h-[100dvh] place-items-center text-sm text-foreground-muted">
          Loading chat…
        </div>
      }
    >
      <EmbedCrmChatInner />
    </Suspense>
  );
}
