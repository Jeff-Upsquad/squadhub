import { useEffect, useMemo, useRef } from 'react';

/**
 * Blocking popover shown when a task is checked off while it still has open
 * subtasks or unchecked checklist items. Anchored to the checkbox, styled
 * like NoAssigneeCompleteDialog — but unlike that prompt there is no
 * "complete anyway": the task can only close once everything under it is
 * done (the server enforces the same rule as a backstop). Clicking outside
 * or pressing Escape dismisses.
 */
export default function IncompleteItemsDialog({
  anchorRect,
  openSubtasks,
  openChecklistItems,
  onViewTask,
  onClose,
}: {
  anchorRect: DOMRect | null;
  openSubtasks: number;
  openChecklistItems: number;
  /** When provided, shows a "View open items" button — used by list rows to
   *  open the task detail panel. The detail panel omits it (items are visible). */
  onViewTask?: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Position below the checkbox, flipping above when there isn't room.
  const style = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { top: 0, left: 0 };
    const width = 248;
    const estHeight = 148;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchorRect.left;
    if (left + width > vw - 8) left = vw - width - 8;
    if (left < 8) left = 8;
    const spaceBelow = vh - anchorRect.bottom;
    const top =
      spaceBelow < estHeight && anchorRect.top > spaceBelow
        ? Math.max(8, anchorRect.top - estHeight - 4)
        : anchorRect.bottom + 6;
    return { top, left, width };
  }, [anchorRect]);

  const parts: string[] = [];
  if (openSubtasks > 0) parts.push(`${openSubtasks} subtask${openSubtasks === 1 ? '' : 's'}`);
  if (openChecklistItems > 0) parts.push(`${openChecklistItems} checklist item${openChecklistItems === 1 ? '' : 's'}`);
  const total = openSubtasks + openChecklistItems;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Task has open items"
      className="fixed z-[80] rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] p-3 shadow-2xl"
      style={style}
    >
      <p className="text-[13px] font-semibold text-[var(--sh-ink)]">Open items remain</p>
      <p className="mt-0.5 text-[12px] leading-snug text-[var(--sh-ink-3)]">
        {parts.join(' and ')} still open. Complete {total === 1 ? 'it' : 'them'} to close this task.
      </p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {onViewTask && (
          <button
            type="button"
            onClick={onViewTask}
            className="w-full rounded-md bg-[var(--sh-ink)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--surface)] transition hover:opacity-90"
          >
            View open items
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-md border border-[var(--sh-hair)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--sh-ink)] transition hover:bg-[var(--sh-hair-3)]"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
