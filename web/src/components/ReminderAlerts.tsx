import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Notification, NotificationsReadPayload } from '@squadhub/shared';
import { useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { connectSocket } from '../services/socket';
import { usePMStore } from '../stores/pmStore';

/** Hook mounts before MainLayout branches into desktop/mobile shells. */
export function useReminderAlerts(workspaceId?: string) {
  const qc = useQueryClient();
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!workspaceId) return;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let pending: Notification[] = [];
    let cancelled = false;
    const render = () => root.render(<ReminderAlerts items={pending} onAction={() => { void qc.invalidateQueries(); }} onOpen={id => usePMStore.getState().setActiveTask(id)} onRemove={id => {
      pending = pending.filter(n => n.id !== id); render();
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['my-tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['task'] });
    }} />);
    const add = (n: Notification) => {
      if (n.type !== 'task_reminder' || n.is_read || seen.current.has(n.id)) return;
      seen.current.add(n.id); pending = [...pending, n]; render();
    };
    const read = (p: NotificationsReadPayload) => { pending = pending.filter(n => p.kind !== 'all' && !p.ids.includes(n.id)); render(); };
    const socket = connectSocket();
    socket.on('new_notification', add); socket.on('notifications_read', read);
    const poll = async () => {
      try {
        const res = await api.get('/notifications', { params: { unread_only: true, limit: 200 } });
        if (cancelled) return;
        const items = res.data.data as Notification[];
        pending = pending.filter(n => items.some(item => item.id === n.id));
        items.slice().reverse().forEach(add); render();
      } catch { /* Socket remains active during a polling failure. */ }
    };
    void poll();
    const timer = setInterval(() => void poll(), 15_000);
    return () => { cancelled = true; clearInterval(timer); socket.off('new_notification', add); socket.off('notifications_read', read); root.unmount(); host.remove(); };
  }, [workspaceId, qc]);
}

export function ReminderAlerts({ items, onOpen, onRemove, onAction }: { items: Notification[]; onOpen: (id: string) => void; onRemove: (id: string) => void; onAction?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const [error, setError] = useState('');
  const n = items[0];
  useEffect(() => { setError(''); }, [n?.id]);
  if (!n) return null;
  const act = async (action: 'snooze' | 'complete') => {
    setBusy(true); setError('');
    try {
      await api.post(`/pm/tasks/${n.reference_id}/reminder-action`, { notification_id: n.id, action, minutes });
      onAction?.();
      onRemove(n.id);
    } catch (e: any) { setError(e.response?.data?.error || 'Could not update reminder. Try again.'); }
    finally { setBusy(false); }
  };
  return <aside role="alert" aria-label="Task reminder" className="fixed left-1/2 top-4 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-2xl border p-4 shadow-2xl" style={{ zIndex: 10000, background: 'var(--surface)', color: 'var(--sh-ink)', borderColor: 'var(--sh-hair)', animation: 'reminder-slide-down .25s ease-out' }}>
    <style>{'@keyframes reminder-slide-down { from { opacity:0; transform:translate(-50%, -120%); } to { opacity:1; transform:translate(-50%, 0); } }'}</style>
    <div className="flex justify-between text-xs opacity-70"><span>Reminder · {new Date(String(n.metadata.due_at)).toLocaleString()}</span><button aria-label="Dismiss reminder banner" onClick={() => onRemove(n.id)}>×</button></div>
    <button className="my-3 block text-left text-lg font-semibold" onClick={() => { onOpen(n.reference_id); onRemove(n.id); }}>{n.title}</button>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button disabled={busy} onClick={() => void act('complete')} className="rounded-lg bg-green-600 px-3 py-2 text-white">Complete</button>
      <select aria-label="Snooze duration" value={minutes} onChange={e => setMinutes(Number(e.target.value))} className="rounded border bg-transparent p-2">{[5,10,15,30,60,1440].map(m => <option key={m} value={m}>{m === 1440 ? '1 day' : `${m} min`}</option>)}</select>
      <button disabled={busy} onClick={() => void act('snooze')}>Snooze</button>
      <button onClick={() => { onOpen(n.reference_id); onRemove(n.id); }}>Open task</button>
    </div>
    {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    {items.length > 1 && <p className="mt-2 text-xs opacity-60">{items.length - 1} more reminder(s)</p>}
  </aside>;
}
