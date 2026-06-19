import { useState } from 'react';
import type { TimerSession, TimerType } from '@squadhub/shared';
import { useUpdateTimerSession, useDeleteTimerSession } from '../../../hooks/useTimer';

interface Props {
  session: TimerSession;
  onClose: () => void;
  workspaceId: string | undefined;
  context: string;
}

const TIMER_TYPES: { value: TimerType; label: string }[] = [
  { value: 'work', label: 'Work' },
  { value: 'break', label: 'Break' },
  { value: 'no_work', label: 'No Work' },
];

// Convert an ISO string to the "YYYY-MM-DDTHH:MM" form that datetime-local
// inputs expect, in the user's local timezone.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// datetime-local → ISO string
function fromLocalInput(local: string): string {
  return new Date(local).toISOString();
}

export default function EditSessionModal({ session, onClose, workspaceId, context }: Props) {
  const [startLocal, setStartLocal] = useState(toLocalInput(session.start_time));
  const [endLocal, setEndLocal] = useState(session.end_time ? toLocalInput(session.end_time) : '');
  const [type, setType] = useState<TimerType>(session.timer_type);
  const [error, setError] = useState('');

  const scope = { workspaceId, context };
  const updateMut = useUpdateTimerSession(scope);
  const deleteMut = useDeleteTimerSession(scope);

  const busy = updateMut.isPending || deleteMut.isPending;

  async function handleSave() {
    setError('');
    try {
      const startIso = fromLocalInput(startLocal);
      const endIso = fromLocalInput(endLocal);
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        setError('End time must be after start time');
        return;
      }
      await updateMut.mutateAsync({
        session_id: session.id,
        start_time: startIso,
        end_time: endIso,
        timer_type: type,
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to update');
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this session? This cannot be undone.')) return;
    setError('');
    try {
      await deleteMut.mutateAsync(session.id);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to delete');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">Edit Session</h3>
          <button onClick={onClose} className="rounded-md p-1 text-foreground-muted hover:bg-surface-alt">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-foreground-dim">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {TIMER_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={`rounded-md border px-3 py-2 text-sm transition ${
                    type === t.value
                      ? 'border-accent bg-accent/10 font-medium text-accent'
                      : 'border-divider text-foreground-muted hover:bg-surface-alt'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-foreground-dim">Start</label>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              className="w-full rounded-md border border-divider px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-foreground-dim">End</label>
            <input
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              className="w-full rounded-md border border-divider px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10 disabled:opacity-50"
            >
              Delete
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md border border-divider px-3 py-2 text-sm text-foreground-muted hover:bg-surface-alt disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={busy}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {updateMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
