import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import UnreadBadge from '../../components/UnreadBadge';

/*
 * "Client workspaces" — internal staff's shared workspaces on Squad Hub SaaS
 * (app.squadhub.in), with unread counts. Served by GET /saas/my-workspaces
 * (server/src/routes/saas-staff.ts). Renders nothing when the bridge isn't
 * configured (503), on any error, or when the user has no shared workspaces.
 * "Open" mints a one-time SSO link (POST /saas/sso) and opens it in a new tab.
 */

interface SaasStaffWorkspace {
  id: string;
  name?: string | null;
  account_name?: string | null;
  unread_count?: number | null;
}

function toList(data: unknown): SaasStaffWorkspace[] {
  if (Array.isArray(data)) return data as SaasStaffWorkspace[];
  const d = (data || {}) as { workspaces?: unknown; items?: unknown };
  const list = d.workspaces || d.items;
  return Array.isArray(list) ? (list as SaasStaffWorkspace[]) : [];
}

export default function SaasClientWorkspaces() {
  const [opening, setOpening] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['saas-my-workspaces'],
    queryFn: async () => toList((await api.get('/saas/my-workspaces')).data?.data),
    retry: false,
    staleTime: 60_000,
    // Stop polling once the bridge says no (503 not connected / 403) — no point hammering it.
    refetchInterval: (q) => (q.state.error ? false : 120_000),
    refetchOnWindowFocus: (q) => !q.state.error,
  });

  if (!data || data.length === 0) return null;

  const open = async (ws: SaasStaffWorkspace) => {
    // Open synchronously inside the click so popup blockers allow it.
    const win = window.open('about:blank', '_blank');
    if (win) win.opener = null;
    setOpening(ws.id);
    try {
      const res = await api.post('/saas/sso', { workspace_id: ws.id });
      const d = res.data?.data;
      const url: string | null = typeof d === 'string' ? d : d?.url || d?.login_url || null;
      if (!url) throw new Error('No login link returned');
      if (win) win.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      win?.close();
      window.alert('Could not open the client workspace. Please try again.');
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between pb-1 pl-4 pr-3 pt-4">
        <span className="sb-section truncate text-[var(--sh-ink-3)]">Client workspaces</span>
      </div>
      <div className="px-2">
        {data.map((ws) => {
          const label = ws.name || ws.account_name || 'Client workspace';
          return (
            <button
              key={ws.id}
              type="button"
              title={ws.account_name && ws.name ? `${ws.account_name} · ${ws.name} — opens Squad Hub SaaS` : `${label} — opens Squad Hub SaaS`}
              onClick={() => open(ws)}
              disabled={opening === ws.id}
              className="mb-[1px] flex w-full items-center gap-[9px] rounded-[10px] px-[10px] py-[6px] text-left text-[13px] text-[var(--sh-ink-2)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] disabled:opacity-60"
            >
              <span className="text-[var(--sh-ink-3)]">
                <svg className="h-[14px] w-[14px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
                </svg>
              </span>
              <span className="flex-1 truncate">{opening === ws.id ? 'Opening…' : label}</span>
              <UnreadBadge count={ws.unread_count || 0} />
              <svg className="h-[11px] w-[11px] shrink-0 text-[var(--sh-ink-4)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </button>
          );
        })}
      </div>
    </>
  );
}
