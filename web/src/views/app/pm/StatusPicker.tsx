import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { SpaceStatus } from '@squadhub/shared';

export default function StatusPicker({
  anchorRect,
  statuses,
  currentStatus,
  onChange,
  onClose,
}: {
  anchorRect: DOMRect | null;
  statuses: SpaceStatus[];
  currentStatus?: string | null;
  onChange: (statusName: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onScrollOrResize = () => onClose();

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [onClose]);

  if (!anchorRect || typeof document === 'undefined') return null;

  const width = 184;
  let left = anchorRect.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (left < 8) left = 8;
  const maxH = 280;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUp = spaceBelow < 200 && anchorRect.top > spaceBelow;
  const top = openUp
    ? Math.max(8, anchorRect.top - maxH - 4)
    : Math.min(anchorRect.bottom + 4, window.innerHeight - 80);

  const displayStatuses: (SpaceStatus | { id: string; name: string; color: string })[] =
    statuses && statuses.length > 0
      ? statuses
      : [
          { id: 'todo', name: 'To Do', color: '#6b7280' },
          { id: 'in_progress', name: 'In Progress', color: '#3b82f6' },
          { id: 'done', name: 'Done', color: '#10b981' },
        ];

  return createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: 99 }}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="nt-menu overflow-y-auto"
        style={{
          position: 'fixed',
          top,
          left,
          width,
          maxHeight: maxH,
          zIndex: 100,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {displayStatuses.map((s) => {
          const isSelected =
            s.name === currentStatus ||
            s.id === currentStatus ||
            s.name.toLowerCase() === (currentStatus || '').toLowerCase();
          return (
            <button
              key={s.id || s.name}
              type="button"
              className="nt-menu-item"
              data-active={isSelected || undefined}
              onClick={(e) => {
                e.stopPropagation();
                onChange(s.name);
                onClose();
              }}
            >
              <span
                className="nt-pri-dot"
                style={{ background: s.color || '#6b7280', borderColor: s.color || '#6b7280' }}
              />
              <span className="truncate flex-1">{s.name}</span>
              {isSelected && (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                  style={{ color: 'var(--sh-ink)' }}
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </>,
    document.body,
  );
}
