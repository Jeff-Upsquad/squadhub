'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

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

export default function TaskSendsPanel({ itemId }: { itemId: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: res, isLoading } = useQuery({
    queryKey: ['lms-collab-task-sends', itemId],
    queryFn: () => api.get(`/lms/collab/items/${itemId}/task-sends`).then((r) => r.data),
  });
  const sends: Send[] = res?.data || [];

  if (isLoading) return <p className="py-3 text-[12px] text-[var(--sh-ink-3)]">Loading…</p>;
  if (!sends.length) return <p className="py-3 text-[12px] text-[var(--sh-ink-3)]">Not sent as a task yet.</p>;

  return (
    <ul className="space-y-2">
      {sends.map((s) => {
        const pct = s.total ? Math.round((s.completed / s.total) * 100) : 0;
        const open = expanded === s.id;
        return (
          <li key={s.id} className="rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)]">
            <div className="flex items-center gap-2 px-3 py-2">
              <button onClick={() => setExpanded(open ? null : s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="text-[var(--sh-ink-3)]">{open ? '▾' : '▸'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--sh-ink)]">{s.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-[var(--sidebar)] px-1.5 py-0.5 text-[10px] font-medium capitalize text-[var(--sh-ink-2)]">{s.scope}</span>
                    {s.auto_resend && <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Auto-resend</span>}
                    <span className="text-[11px] text-[var(--sh-ink-3)]">{s.completed}/{s.total} done · {pct}%</span>
                  </span>
                </span>
              </button>
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
    queryKey: ['lms-collab-send-recipients', sendId],
    queryFn: () => api.get(`/lms/collab/task-sends/${sendId}/recipients`).then((r) => r.data),
  });
  const recipients: Recipient[] = res?.data || [];
  if (isLoading) return <p className="border-t border-[var(--sh-hair)] px-3 py-2 text-[12px] text-[var(--sh-ink-3)]">Loading…</p>;
  if (!recipients.length) return <p className="border-t border-[var(--sh-hair)] px-3 py-2 text-[12px] text-[var(--sh-ink-3)]">No recipients.</p>;

  return (
    <ul className="border-t border-[var(--sh-hair)] px-3 py-2">
      {recipients.map((r) => (
        <li key={r.id} className="flex items-center gap-2 py-1">
          <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] ${r.completed ? 'bg-emerald-500 text-white' : 'border border-[var(--sh-hair)] text-transparent'}`}>✓</span>
          <span className="flex-1 truncate text-[12.5px] text-[var(--sh-ink)]">{r.user?.display_name || r.user?.email || 'Unknown'}</span>
          <span className={`text-[11px] ${r.completed ? 'text-emerald-600' : 'text-[var(--sh-ink-3)]'}`}>{r.completed ? 'Completed' : 'Pending'}</span>
        </li>
      ))}
    </ul>
  );
}
