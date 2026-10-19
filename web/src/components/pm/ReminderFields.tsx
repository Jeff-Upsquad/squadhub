import { useEffect, useMemo } from 'react';
import { parseReminderTitle } from '@squadhub/shared';
import { localDateTime } from './ReminderScheduleDialog';

export default function ReminderFields({ title, reminder, due, onDetect, onDue }: {
  title: string; reminder: boolean; due: string | null;
  onDetect: (due: string | null) => void; onDue: (due: string | null) => void;
}) {
  const parsed = useMemo(() => parseReminderTitle(title, new Date(), -new Date().getTimezoneOffset(), reminder), [title, reminder]);
  useEffect(() => { if (parsed.intent) onDetect(parsed.dueDate); }, [parsed]);
  if (!parsed.intent && !reminder) return null;
  return <div className="mb-4 rounded-xl border p-3" style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface-alt)' }}>
    <div className="mb-2 text-sm font-medium">Reminders</div>
    <label className="flex flex-wrap items-center gap-3 text-sm">Remind me at
      <input aria-label="Reminder date and time" type="datetime-local" required value={due ? localDateTime(due) : ''}
        onChange={e => onDue(e.target.value ? new Date(e.target.value).toISOString() : null)} className="rounded border bg-transparent px-2 py-1" />
    </label>
    <p className="mt-2 text-xs opacity-70">{parsed.intent ? `Saved title: ${parsed.title || 'Add a task name'}. ` : ''}The reminder time is saved as the due date. {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
  </div>;
}
