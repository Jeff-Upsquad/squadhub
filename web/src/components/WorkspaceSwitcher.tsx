'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Workspace } from '@squadhub/shared';
import api from '../services/api';
import { useWorkspaceStore } from '../stores/workspaceStore';

// Remember the last active workspace per browser (convenience only; the server
// re-verifies membership on every request via X-Workspace-Id).
export const ACTIVE_WORKSPACE_KEY = 'squadhub-saas.activeWorkspaceId';

export function rememberActiveWorkspace(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

export function rememberedActiveWorkspace(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function useMyWorkspaces() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces').then((r) => (r.data?.data || []) as Workspace[]),
  });
}

/** Switch the active workspace (account). Clears per-workspace UI state. */
export function useSwitchWorkspace() {
  const qc = useQueryClient();
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const setActiveChannel = useWorkspaceStore((s) => s.setActiveChannel);
  return (ws: Workspace) => {
    if (useWorkspaceStore.getState().currentWorkspace?.id === ws.id) return;
    setActiveChannel(null);
    setWorkspace(ws as any);
    rememberActiveWorkspace(ws.id);
    // Per-workspace data refetches under its new key; aggregated views (My
    // Tasks, Inbox, notifications) already span every workspace.
    void qc.invalidateQueries({ queryKey: ['channels'] });
    void qc.invalidateQueries({ queryKey: ['spaces'] });
  };
}

const KIND_LABEL: Record<string, string> = {
  business: 'Business',
  talent: 'Talent',
  internal_staff: 'Squad Hub staff',
  shared: 'Shared',
};

/**
 * Header control for the active workspace: your own accounts first, then the
 * shared workspaces you're in, grouped by the business that hosts them.
 */
export default function WorkspaceSwitcher() {
  const { data: workspaces = [] } = useMyWorkspaces();
  const current = useWorkspaceStore((s) => s.currentWorkspace);
  const switchTo = useSwitchWorkspace();
  const [open, setOpen] = useState(false);

  const { own, sharedByHost } = useMemo(() => {
    const own = workspaces.filter((w) => w.kind !== 'shared');
    const sharedByHost = new Map<string, Workspace[]>();
    for (const w of workspaces.filter((x) => x.kind === 'shared')) {
      const key = w.host_name || 'Shared';
      sharedByHost.set(key, [...(sharedByHost.get(key) || []), w]);
    }
    return { own, sharedByHost };
  }, [workspaces]);

  if (!current) return null;

  const row = (w: Workspace) => (
    <button
      key={w.id}
      type="button"
      onClick={() => {
        switchTo(w);
        setOpen(false);
      }}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition hover:bg-[var(--sh-hair-3)] ${
        w.id === current.id ? 'font-semibold text-[var(--sh-ink)]' : 'text-[var(--sh-ink-2)]'
      }`}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[var(--sh-hair-2)] text-[10px] font-bold uppercase">
        {w.name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1 truncate">{w.name}</span>
      {w.status === 'suspended' && <span className="text-[10px] text-red-600">Suspended</span>}
      {w.id === current.id && <span aria-hidden>✓</span>}
    </button>
  );

  return (
    <div className="relative px-3 pb-2" data-tip-anchor="sidebar.workspace-switcher">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-[var(--sh-hair)] px-2 py-1.5 text-left text-[12.5px] text-[var(--sh-ink)] transition hover:bg-[var(--sh-hair-3)]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{current.name}</span>
          <span className="block truncate text-[10.5px] text-[var(--sh-ink-4)]">
            {current.kind === 'shared'
              ? `Shared · ${current.host_name || 'business'}`
              : KIND_LABEL[current.kind] || 'Workspace'}
          </span>
        </span>
        <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-3 right-3 top-[calc(100%-2px)] z-50 max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] p-1 shadow-xl" role="listbox">
            <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--sh-ink-4)]">Your accounts</div>
            {own.map(row)}
            {[...sharedByHost.entries()].map(([host, list]) => (
              <div key={host}>
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--sh-ink-4)]">
                  Shared · {host}
                </div>
                {list.map(row)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
