import { useState } from 'react';
import { createRoot } from 'react-dom/client';

export function localDateTime(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Shared by every task writer through the API client, including inline/mobile creation. */
export function requestReminderSchedule(suggestedDate?: string | null): Promise<string | null> {
  return new Promise(resolve => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const finish = (value: string | null) => { resolve(value); setTimeout(() => { root.unmount(); container.remove(); }, 0); };
    root.render(<ReminderScheduleDialog initial={suggestedDate} onClose={finish} />);
  });
}

function ReminderScheduleDialog({ initial, onClose }: { initial?: string | null; onClose: (value: string | null) => void }) {
  const [value, setValue] = useState(initial ? localDateTime(initial) : '');
  const [error, setError] = useState('');
  return <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4" style={{ zIndex: 100100 }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(null); }}>
    <form role="dialog" aria-modal="true" aria-labelledby="reminder-schedule-title" className="w-full max-w-sm rounded-2xl border p-5 shadow-xl" style={{ background: 'var(--surface)', color: 'var(--sh-ink)', borderColor: 'var(--sh-hair)' }} onSubmit={e => {
      e.preventDefault();
      const date = new Date(value);
      if (!value || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) { setError('Choose a future date and time.'); return; }
      onClose(date.toISOString());
    }}>
      <h2 id="reminder-schedule-title" className="text-lg font-semibold">When should we remind you?</h2>
      <p className="my-3 text-sm opacity-70">Choose a date and time in {Intl.DateTimeFormat().resolvedOptions().timeZone}. This becomes the task’s due date.</p>
      <input autoFocus required aria-label="Reminder date and time" type="datetime-local" value={value} onChange={e => setValue(e.target.value)} className="w-full rounded-lg border bg-transparent p-3" />
      {error && <p role="alert" className="mt-2 text-sm text-red-500">{error}</p>}
      <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => onClose(null)}>Cancel</button><button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-white">Set reminder</button></div>
    </form>
  </div>;
}
