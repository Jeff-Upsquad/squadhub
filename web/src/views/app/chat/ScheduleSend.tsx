import { useState } from 'react';
import type { ChatKind } from '../../../stores/workspaceStore';
import { useCancelScheduledMessage, useScheduledMessages } from '../../../hooks/useScheduledMessages';

// "Today 5:30 PM" / "Tomorrow 9:00 AM" / "Jun 13, 9:00 AM"
export function formatScheduledTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return `Today ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, tomorrow)) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

// Local "yyyy-MM-ddTHH:mm" for <input type="datetime-local">
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

// ---- Schedule picker modal (presets match the partner app) ----
export function ScheduleSendModal({
  onPick,
  onClose,
}: {
  onPick: (isoUtc: string) => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const [customValue, setCustomValue] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    return toLocalInputValue(d);
  });
  const [customError, setCustomError] = useState<string | null>(null);

  const pick = (ms: number) => onPick(new Date(ms).toISOString());

  const tomorrowNine = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  };

  const confirmCustom = () => {
    const when = new Date(customValue).getTime();
    if (Number.isNaN(when)) { setCustomError('Pick a valid date and time.'); return; }
    if (when < Date.now() + 2 * 60 * 1000) { setCustomError('Must be at least a couple of minutes from now.'); return; }
    if (when > Date.now() + 90 * 24 * 60 * 60 * 1000) { setCustomError('Can be at most 90 days out.'); return; }
    pick(when);
  };

  const presetCls =
    'flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 text-left text-[13.5px] text-[var(--sh-ink)] transition hover:bg-[var(--sh-hair-3)]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-[320px] rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-[14.5px] font-semibold text-[var(--sh-ink)]">Schedule message</h3>
        {!custom ? (
          <div className="flex flex-col">
            <button type="button" className={presetCls} onClick={() => pick(Date.now() + 30 * 60 * 1000)}>
              <ClockIcon className="text-[var(--sh-ink-3)]" /> In 30 minutes
            </button>
            <button type="button" className={presetCls} onClick={() => pick(Date.now() + 60 * 60 * 1000)}>
              <ClockIcon className="text-[var(--sh-ink-3)]" /> In 1 hour
            </button>
            <button type="button" className={presetCls} onClick={() => pick(tomorrowNine())}>
              <ClockIcon className="text-[var(--sh-ink-3)]" /> Tomorrow at 9:00 AM
            </button>
            <button type="button" className={presetCls} onClick={() => setCustom(true)}>
              <ClockIcon className="text-[var(--sh-ink-3)]" /> Pick a date &amp; time…
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="datetime-local"
              value={customValue}
              min={toLocalInputValue(new Date(Date.now() + 2 * 60 * 1000))}
              onChange={(e) => { setCustomValue(e.target.value); setCustomError(null); }}
              className="rounded-[6px] border border-[var(--sh-hair)] bg-transparent px-2 py-1.5 text-[13px] text-[var(--sh-ink)]"
            />
            {customError && <p className="text-[11.5px] text-red-500">{customError}</p>}
            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustom(false)}
                className="rounded-[6px] px-2.5 py-1.5 text-[12.5px] text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={confirmCustom}
                className="rounded-[6px] bg-[var(--sh-ink)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--surface)]"
              >
                Schedule
              </button>
            </div>
          </div>
        )}
        {!custom && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] px-2.5 py-1.5 text-[12.5px] text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Pending strip above the composer (count + expandable list with cancel) ----
export function ScheduledStrip({ kind, conversationId }: { kind: ChatKind; conversationId: string }) {
  const { data: scheduled } = useScheduledMessages(kind, conversationId);
  const cancel = useCancelScheduledMessage(conversationId);
  const [open, setOpen] = useState(false);

  if (!scheduled || scheduled.length === 0) return null;

  return (
    <div className="mb-2 rounded-[6px] border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] text-[12.5px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--sh-ink-2)] hover:text-[var(--sh-ink)]"
      >
        <ClockIcon />
        <span className="flex-1">
          {scheduled.length} scheduled message{scheduled.length > 1 ? 's' : ''}
        </span>
        <span className="text-[11.5px] text-[var(--sh-ink-4)]">{open ? 'Hide' : 'View'}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--sh-hair)] px-3 py-1.5">
          {scheduled.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-1">
              <span className="shrink-0 font-medium text-[var(--sh-ink-2)]">{formatScheduledTime(m.scheduled_at)}</span>
              <span className="flex-1 truncate text-[var(--sh-ink-3)]">{m.content}</span>
              <button
                type="button"
                onClick={() => cancel.mutate(m.id)}
                disabled={cancel.isPending}
                className="shrink-0 text-[11.5px] text-[var(--sh-ink-4)] underline-offset-2 hover:text-red-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
