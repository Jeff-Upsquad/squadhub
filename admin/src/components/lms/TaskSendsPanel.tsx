'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

interface Props {
  itemId: string;
}

type Send = {
  id: string;
  scope: 'item' | 'lesson' | 'section';
  title: string;
  section_label: string | null;
  auto_resend: boolean;
  due_date: string | null;
  total: number;
  completed: number;
  created_at: string;
};

type Recipient = {
  id: string;
  completed: boolean;
  user: { id: string; display_name?: string; email?: string; user_type?: string } | null;
};

// Admin tracker for Resources "send as task": every send on this item with a
// completed/total count, expandable to a per-recipient roster, plus Resend
// (reopen + re-notify) and Unsend (remove the tasks).
export default function TaskSendsPanel({ itemId }: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: res, isLoading } = useQuery({
    queryKey: ['lms-task-sends', itemId],
    queryFn: () => api.get(`/admin/lms/items/${itemId}/task-sends`).then((r) => r.data),
  });
  const sends: Send[] = res?.data || [];

  const resend = useMutation({
    mutationFn: (sendId: string) => api.post(`/admin/lms/task-sends/${sendId}/resend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-task-sends', itemId] }),
    onError: (e: any) => alert(e?.response?.data?.error || 'Resend failed'),
  });
  const unsend = useMutation({
    mutationFn: (sendId: string) => api.delete(`/admin/lms/task-sends/${sendId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lms-task-sends', itemId] }),
    onError: (e: any) => alert(e?.response?.data?.error || 'Unsend failed'),
  });

  if (isLoading) return <p className="py-3 text-[12px] text-foreground-dim">Loading…</p>;
  if (!sends.length) return <p className="py-3 text-[12px] text-foreground-dim">Not sent as a task yet.</p>;

  return (
    <ul className="space-y-2">
      {sends.map((s) => {
        const pct = s.total ? Math.round((s.completed / s.total) * 100) : 0;
        const open = expanded === s.id;
        return (
          <li key={s.id} className="rounded-lg border border-divider bg-surface">
            <div className="flex items-center gap-2 px-3 py-2">
              <button onClick={() => setExpanded(open ? null : s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="text-foreground-dim">{open ? '▾' : '▸'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{s.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium capitalize text-foreground-muted">{s.scope}</span>
                    {s.auto_resend && <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Auto-resend</span>}
                    <span className="text-[11px] text-foreground-dim">{s.completed}/{s.total} done · {pct}%</span>
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => resend.mutate(s.id)}
                  disabled={resend.isPending}
                  className="rounded-md border border-divider bg-surface px-2 py-1 text-[11.5px] text-foreground-muted hover:bg-surface-alt disabled:opacity-50"
                  title="Reopen and re-notify recipients"
                >
                  Resend
                </button>
                <button
                  onClick={() => { if (confirm('Remove this task from everyone it was sent to?')) unsend.mutate(s.id); }}
                  disabled={unsend.isPending}
                  className="rounded-md border border-divider bg-surface px-2 py-1 text-[11.5px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Unsend
                </button>
              </div>
            </div>
            {open && <RecipientRoster sendId={s.id} />}
          </li>
        );
      })}
    </ul>
  );
}

function RecipientRoster({ sendId }: { sendId: string }) {
  const { data: res, isLoading } = useQuery({
    queryKey: ['lms-send-recipients', sendId],
    queryFn: () => api.get(`/admin/lms/task-sends/${sendId}/recipients`).then((r) => r.data),
  });
  const recipients: Recipient[] = res?.data || [];
  if (isLoading) return <p className="border-t border-divider px-3 py-2 text-[12px] text-foreground-dim">Loading…</p>;
  if (!recipients.length) return <p className="border-t border-divider px-3 py-2 text-[12px] text-foreground-dim">No recipients.</p>;

  return (
    <ul className="border-t border-divider px-3 py-2">
      {recipients.map((r) => (
        <li key={r.id} className="flex items-center gap-2 py-1">
          <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] ${r.completed ? 'bg-emerald-500 text-white' : 'border border-divider-strong text-transparent'}`}>✓</span>
          <span className="flex-1 truncate text-[12.5px] text-foreground">{r.user?.display_name || r.user?.email || 'Unknown'}</span>
          <span className={`text-[11px] ${r.completed ? 'text-emerald-600' : 'text-foreground-dim'}`}>{r.completed ? 'Completed' : 'Pending'}</span>
        </li>
      ))}
    </ul>
  );
}
