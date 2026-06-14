import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

interface GroupRow {
  id: string;
  name: string;
  app_scope: 'clients' | 'team';
}

interface BroadcastMsg {
  id: string;
  group_id: string;
  content: string | null;
  type: string;
  file_url: string | null;
  created_at: string;
  sender: { id: string; display_name: string };
  group: { id: string; name: string; app_scope: string };
}

export default function SquadChatBroadcastsModule() {
  const qc = useQueryClient();
  const [groupId, setGroupId] = useState('');
  const [content, setContent] = useState('');

  const { data: groupsRes } = useQuery({
    queryKey: ['admin-chat-groups'],
    queryFn: () => api.get('/admin/chat/groups').then((r) => r.data),
  });
  const groups: GroupRow[] = (groupsRes?.data || []).filter((g: GroupRow) => !('archived_at' in g) || !(g as GroupRow & { archived_at: string | null }).archived_at);

  const { data: historyRes } = useQuery({
    queryKey: ['admin-chat-broadcasts'],
    queryFn: () => api.get('/admin/chat/broadcasts').then((r) => r.data),
    refetchInterval: 10000,
  });
  const history: BroadcastMsg[] = historyRes?.data || [];

  const send = useMutation({
    mutationFn: () => api.post('/admin/chat/broadcasts', { group_id: groupId, content, type: 'text' }),
    onSuccess: () => {
      setContent('');
      qc.invalidateQueries({ queryKey: ['admin-chat-broadcasts'] });
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">Broadcasts</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Send a message to every member of a group as an Admin. Recipients will get a push notification.
        </p>
      </div>

      <div className="rounded-xl border border-divider bg-surface p-5 space-y-3">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-foreground-muted mb-1">Group</label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="w-full rounded-md border border-divider px-3 py-2 text-sm"
          >
            <option value="">Select a group…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {g.app_scope === 'clients' ? 'Clients' : 'Team'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-foreground-muted mb-1">Message</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            placeholder="Write an announcement…"
            className="w-full rounded-md border border-divider px-3 py-2 text-sm"
          />
        </div>
        <div className="flex justify-end">
          <button
            onClick={() => send.mutate()}
            disabled={!groupId || !content.trim() || send.isPending}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50"
          >
            {send.isPending ? 'Sending…' : 'Send broadcast'}
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground-muted mb-3">Last 30 days</h2>
        <div className="rounded-xl border border-divider bg-surface">
          {history.length === 0 ? (
            <div className="p-6 text-center text-sm text-foreground-muted">No recent broadcasts.</div>
          ) : (
            <ul className="divide-y divide-[#F1F5F9]">
              {history.map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium">{m.group?.name || 'Group'}</div>
                    <div className="text-[11px] text-foreground-dim">{new Date(m.created_at).toLocaleString()}</div>
                  </div>
                  <div className="text-sm text-foreground">{m.content || `[${m.type}]`}</div>
                  <div className="text-[11px] text-foreground-muted mt-1">by {m.sender?.display_name}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
