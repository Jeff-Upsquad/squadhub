import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskPriority } from '@squadhub/shared';
import EmergencyConfirm from './EmergencyConfirm';

// Single source of truth for priority label + dot colour across the PM list
// surfaces. Colours mirror TaskPriorityBadge so a task reads the same whether
// it shows as a badge, a flag, or this inline cell.
export const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> = {
  emergency: { label: 'Emergency', color: '#b91c1c' },
  urgent:    { label: 'Urgent',    color: '#ef4444' },
  high:      { label: 'High',      color: '#f97316' },
  normal:    { label: 'Normal',    color: '#3b82f6' },
  low:       { label: 'Low',       color: '#6b7280' },
  none:      { label: 'None',      color: 'transparent' },
};

const STANDARD: TaskPriority[] = ['urgent', 'high', 'normal', 'low', 'none'];

// Anchored popover for changing a task's priority — same shape as the other
// inline pickers (AssigneePicker / DatePicker): position from a cell rect,
// close on outside-click or Escape. Emergency routes through the confirmation
// dialog, exactly like the detail panel.
export default function PriorityPicker({
  anchorRect,
  value,
  onChange,
  onClose,
  taskTitle,
}: {
  anchorRect: DOMRect | null;
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
  onClose: () => void;
  taskTitle?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmEmergency, setConfirmEmergency] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      // ref is only set while the menu is mounted — when the emergency confirm
      // takes over, ref.current is null so this is a no-op and the dialog owns
      // its own dismissal.
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  if (!anchorRect || typeof document === 'undefined') return null;

  if (confirmEmergency) {
    return createPortal(
      <EmergencyConfirm
        taskTitle={taskTitle}
        onConfirm={() => { onChange('emergency'); onClose(); }}
        onCancel={() => setConfirmEmergency(false)}
      />,
      document.body,
    );
  }

  const width = 184;
  let left = anchorRect.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 300);

  return createPortal(
    <div ref={ref} className="nt-menu" style={{ position: 'fixed', top, left, width, zIndex: 100 }}>
      {STANDARD.map((p) => {
        const m = PRIORITY_META[p];
        return (
          <button
            key={p}
            type="button"
            className="nt-menu-item"
            data-active={p === value || undefined}
            onClick={() => { onChange(p); onClose(); }}
          >
            <span
              className="nt-pri-dot"
              style={{ background: m.color, borderColor: p === 'none' ? 'var(--sh-hair-2)' : m.color }}
            />
            {m.label}
          </button>
        );
      })}
      <div className="td-menu-divider" />
      <button
        type="button"
        className="nt-menu-item td-menu-danger"
        data-active={value === 'emergency' || undefined}
        onClick={() => setConfirmEmergency(true)}
      >
        <span
          className="nt-pri-dot"
          style={{ background: PRIORITY_META.emergency.color, borderColor: PRIORITY_META.emergency.color }}
        />
        Emergency
      </button>
    </div>,
    document.body,
  );
}
