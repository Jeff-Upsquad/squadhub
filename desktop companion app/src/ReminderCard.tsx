import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import type { Notification, NotificationsReadPayload } from '@squadhub/shared';
import { apiFetch } from './services/api';

export function useCompanionReminders(enabled: boolean) {
  const [items, setItems] = useState<Notification[]>([]);
  useEffect(() => {
    if (!enabled) { setItems([]); return; }
    let cancelled = false;
    const seen = new Set<string>();
    const add = (n: Notification) => {
      if (n.type !== 'task_reminder' || n.is_read || seen.has(n.id)) return;
      seen.add(n.id); setItems(old => [...old, n]);
    };
    const received = listen<Notification>('reminder:received', e => add(e.payload));
    const read = listen<NotificationsReadPayload>('reminder:read', e => setItems(old => old.filter(n => e.payload.kind !== 'all' && !e.payload.ids.includes(n.id))));
    const poll = async () => {
      try {
        const res = await apiFetch('/notifications?unread_only=true&limit=200');
        const json = await res.json();
        if (cancelled || !res.ok || !json.success) return;
        const rows = json.data as Notification[];
        setItems(old => old.filter(n => rows.some(r => r.id === n.id)));
        rows.slice().reverse().forEach(add);
      } catch { /* Retry at the next poll. */ }
    };
    void poll();
    const timer = setInterval(() => void poll(), 15_000);
    return () => { cancelled = true; clearInterval(timer); void received.then(fn => fn()); void read.then(fn => fn()); };
  }, [enabled]);
  return { reminder: items[0], dismiss: (id: string) => setItems(old => old.filter(n => n.id !== id)) };
}

export default function ReminderCard({ reminder: n, dismiss }: { reminder: Notification; dismiss: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const [error, setError] = useState('');
  const act = async (action: string) => {
    setBusy(true); setError('');
    try {
      const res = await apiFetch(`/pm/tasks/${n.reference_id}/reminder-action`, { method: 'POST', body: JSON.stringify({ notification_id: n.id, action, minutes }) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not update reminder');
      dismiss(n.id);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="companion-reminder" role="alert">
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Reminder · {new Date(String(n.metadata.due_at)).toLocaleString()}</span><button onClick={() => dismiss(n.id)} aria-label="Dismiss reminder">×</button></div>
    <h2>{n.title}</h2>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <button disabled={busy} onClick={() => void act('complete')}>Complete</button>
      <select aria-label="Snooze duration" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>{[5,10,15,30,60,1440].map(m => <option key={m} value={m}>{m === 1440 ? '1 day' : `${m} min`}</option>)}</select>
      <button disabled={busy} onClick={() => void act('snooze')}>Snooze</button>
      <button onClick={() => { void open(`https://squadhub.in/app?open_inbox=${encodeURIComponent(n.id)}`); dismiss(n.id); }}>Open task</button>
    </div>
    {error && <p role="alert" style={{ color: '#ff8080' }}>{error}</p>}
  </section>;
}
