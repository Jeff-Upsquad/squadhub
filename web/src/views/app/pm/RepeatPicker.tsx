import { useEffect, useMemo, useRef, useState } from 'react';
import type { TaskRecurrence, TaskRecurrenceKind } from '@squadhub/shared';

// Anchored popover for choosing a task's recurrence rule. Mirrors the
// interaction model of DatePicker (fixed panel near anchorRect, Escape /
// click-outside to dismiss) but commits only on Save — weekly rules need
// several taps to assemble, so live-committing would spam PUTs.

type KindOption = TaskRecurrenceKind | 'never';

const KIND_LABELS: Array<{ key: KindOption; label: string }> = [
  { key: 'never', label: "Doesn't repeat" },
  { key: 'daily', label: 'Every day' },
  { key: 'weekdays', label: 'Every weekday (Mon–Fri)' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

const DOW_CHIPS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function RepeatPicker({
  anchorRect,
  value,
  onChange,
  onClose,
}: {
  anchorRect: DOMRect | null;
  value: TaskRecurrence | null | undefined;
  onChange: (next: TaskRecurrence | null) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<KindOption>(value?.kind ?? 'never');
  const [weekdays, setWeekdays] = useState<number[]>(value?.weekdays ?? []);
  const [dayOfMonth, setDayOfMonth] = useState<number>(value?.day_of_month ?? 1);
  const [endsOn, setEndsOn] = useState<string>(value?.ends_on ?? '');

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onClickOutside(e: MouseEvent) {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose]);

  const style = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { top: 0, left: 0 };
    const width = 272;
    const estHeight = 330;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const placeAbove = vh - anchorRect.bottom < estHeight && anchorRect.top > vh - anchorRect.bottom;
    let left = anchorRect.left + anchorRect.width / 2 - width / 2;
    if (left + width > vw - 8) left = vw - width - 8;
    if (left < 8) left = 8;
    const top = placeAbove
      ? Math.max(8, anchorRect.top - estHeight - 6)
      : anchorRect.bottom + 6;
    return { top, left, width };
  }, [anchorRect]);

  const canSave = kind !== 'weekly' || weekdays.length > 0;

  function toggleWeekday(d: number) {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function save() {
    if (kind === 'never') {
      onChange(null);
      onClose();
      return;
    }
    const rule: TaskRecurrence = { kind };
    if (kind === 'weekly') rule.weekdays = weekdays;
    if (kind === 'monthly') rule.day_of_month = Math.min(28, Math.max(1, dayOfMonth));
    if (endsOn) rule.ends_on = endsOn;
    onChange(rule);
    onClose();
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-[56] rounded-xl border shadow-lg"
      style={{ ...style, borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
      role="dialog"
      aria-label="Repeat settings"
    >
      <div className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--sh-ink-3)]">
        Repeat
      </div>

      <div className="px-1.5 pb-1">
        {KIND_LABELS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setKind(key)}
            className={`flex w-full items-center justify-between rounded-[7px] px-2 py-[6px] text-left text-[13px] transition hover:bg-[color:var(--sh-hair-3)] ${
              kind === key ? 'font-medium text-[color:var(--sh-ink)]' : 'text-[color:var(--sh-ink-2)]'
            }`}
          >
            <span>{label}</span>
            {kind === key && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        ))}
      </div>

      {kind === 'weekly' && (
        <div className="px-3 pb-2">
          <div className="mb-1 text-[11px] text-[color:var(--sh-ink-3)]">On days</div>
          <div className="flex gap-1">
            {DOW_CHIPS.map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleWeekday(i)}
                aria-pressed={weekdays.includes(i)}
                className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-medium transition ${
                  weekdays.includes(i)
                    ? 'bg-[var(--sh-ink)] text-[var(--surface)]'
                    : 'bg-[color:var(--sh-hair-3)] text-[color:var(--sh-ink-2)] hover:bg-[color:var(--sh-hair-2)]'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {kind === 'monthly' && (
        <div className="flex items-center gap-2 px-3 pb-2">
          <span className="text-[12px] text-[color:var(--sh-ink-3)]">On day</span>
          <input
            type="number"
            min={1}
            max={28}
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(parseInt(e.target.value || '1', 10))}
            className="w-16 rounded-[7px] border bg-transparent px-2 py-1 text-[13px] outline-none"
            style={{ borderColor: 'var(--sh-hair)' }}
          />
          <span className="text-[11px] text-[color:var(--sh-ink-4)]">1–28</span>
        </div>
      )}

      {kind !== 'never' && (
        <div className="flex items-center gap-2 px-3 pb-2">
          <span className="text-[12px] text-[color:var(--sh-ink-3)]">Ends</span>
          <input
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className="flex-1 rounded-[7px] border bg-transparent px-2 py-1 text-[12px] outline-none"
            style={{ borderColor: 'var(--sh-hair)', colorScheme: 'inherit' }}
          />
          {endsOn ? (
            <button
              type="button"
              onClick={() => setEndsOn('')}
              className="text-[13px] text-[color:var(--sh-ink-4)] hover:text-[color:var(--sh-ink)]"
              aria-label="Clear end date"
            >
              ×
            </button>
          ) : (
            <span className="text-[11px] text-[color:var(--sh-ink-4)]">never</span>
          )}
        </div>
      )}

      <div className="flex justify-end gap-1.5 border-t px-2.5 py-2" style={{ borderColor: 'var(--sh-hair-2)' }}>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[7px] px-2.5 py-1 text-[12.5px] text-[color:var(--sh-ink-2)] hover:bg-[color:var(--sh-hair-3)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded-[7px] bg-[var(--sh-ink)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--surface)] disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
