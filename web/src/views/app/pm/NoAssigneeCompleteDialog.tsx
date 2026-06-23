import { useEffect, useMemo, useRef } from 'react';

/**
 * Lightweight popover shown when a task is checked off while it has no
 * assignee. Anchored to the checkbox. Offers to assign (to me / to someone
 * else) before completing, or to complete as-is. Clicking outside or pressing
 * Escape cancels without completing — a safe out for a stray checkbox click.
 */
export default function NoAssigneeCompleteDialog({
  anchorRect,
  canAssignToMe,
  onAssignToMe,
  onAssignOther,
  onCompleteAnyway,
  onClose,
}: {
  anchorRect: DOMRect | null;
  /** Hide "Assign to me" when the current user can't be resolved. */
  canAssignToMe: boolean;
  onAssignToMe: () => void;
  onAssignOther: () => void;
  onCompleteAnyway: () => void;
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
    const estHeight = 176;
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

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Task has no assignee"
      className="fixed z-[80] rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] p-3 shadow-2xl"
      style={style}
    >
      <p className="text-[13px] font-semibold text-[var(--sh-ink)]">No assignee</p>
      <p className="mt-0.5 text-[12px] leading-snug text-[var(--sh-ink-3)]">
        This task isn’t assigned to anyone yet.
      </p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {canAssignToMe && (
          <button
            type="button"
            onClick={onAssignToMe}
            className="w-full rounded-md bg-[var(--sh-ink)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--surface)] transition hover:opacity-90"
          >
            Assign to me &amp; complete
          </button>
        )}
        <button
          type="button"
          onClick={onAssignOther}
          className="w-full rounded-md border border-[var(--sh-hair)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--sh-ink)] transition hover:bg-[var(--sh-hair-3)]"
        >
          Assign to someone else…
        </button>
        <button
          type="button"
          onClick={onCompleteAnyway}
          className="w-full rounded-md px-2.5 py-1.5 text-[12px] font-medium text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
        >
          Complete without assigning
        </button>
      </div>
    </div>
  );
}
