'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Channel, Space, Workspace } from '@squadhub/shared';
import api from '../services/api';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useMyWorkspaces, useSwitchWorkspace } from './WorkspaceSwitcher';

/**
 * Slack-Connect style: every shared workspace the user is in (e.g. a talent's
 * client engagements) gets its own sidebar section listing its spaces and
 * channels, so nobody has to switch accounts to see them. Clicking an item
 * makes that shared workspace active (requests then carry its X-Workspace-Id)
 * and, for a channel, opens it.
 */
function SharedWorkspaceSection({ ws, onOpenChannel }: { ws: Workspace; onOpenChannel: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const switchTo = useSwitchWorkspace();

  const { data: channels = [] } = useQuery({
    queryKey: ['shared-ws-channels', ws.id],
    queryFn: () => api.get(`/channels?workspace_id=${ws.id}`).then((r) => (r.data?.data || []) as Channel[]),
    enabled: open,
  });
  const { data: spaces = [] } = useQuery({
    queryKey: ['spaces', ws.id],
    queryFn: () => api.get(`/pm/spaces?workspace_id=${ws.id}`).then((r) => (r.data?.data || []) as Space[]),
    enabled: open,
  });

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-4 pb-1 pt-3 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--sh-ink-4)] hover:text-[var(--sh-ink-2)]"
        title={ws.host_name ? `Shared with ${ws.host_name}` : 'Shared workspace'}
      >
        <svg className={`h-2.5 w-2.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 5l6 5-6 5V5z" />
        </svg>
        <span className="truncate">{ws.host_name ? `${ws.host_name} · ${ws.name}` : ws.name}</span>
      </button>
      {open && (
        <div className="px-2">
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => switchTo(ws)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]"
            >
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: (s as any).color || '#8b5cf6' }} />
              <span className="truncate">{s.name}</span>
            </button>
          ))}
          {channels.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                switchTo(ws);
                onOpenChannel(c.id);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)]"
            >
              <span className="w-2 shrink-0 text-[var(--sh-ink-4)]">#</span>
              <span className="truncate">{c.name}</span>
            </button>
          ))}
          {spaces.length === 0 && channels.length === 0 && (
            <p className="px-2 py-1 text-[11.5px] text-[var(--sh-ink-4)]">Nothing shared yet</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SharedWorkspacesSidebar({ onOpenChannel }: { onOpenChannel: (channelId: string) => void }) {
  const { data: workspaces = [] } = useMyWorkspaces();
  const currentId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const shared = workspaces.filter((w) => w.kind === 'shared' && w.id !== currentId && w.status === 'active');
  if (!shared.length) return null;
  return (
    <div data-tip-anchor="sidebar.shared-workspaces">
      {shared.map((ws) => (
        <SharedWorkspaceSection key={ws.id} ws={ws} onOpenChannel={onOpenChannel} />
      ))}
    </div>
  );
}
