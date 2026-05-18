import { useEffect, useMemo, useRef } from 'react';
import { computeSnoozeTargets, useSnoozeTask } from '../../../hooks/useDayPlanner';

interface Props {
  taskId: string;
  isSnoozed: boolean;
  anchor: { left: number; top: number } | null;
  onClose: () => void;
}

export default function SnoozeMenu({ taskId, isSnoozed, anchor, onClose }: Props) {
  const snooze = useSnoozeTask();
  const targets = useMemo(() => computeSnoozeTargets(), []);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onClose]);

  if (!anchor) return null;

  const pick = (iso: string | null) => {
    snooze.mutate({ id: taskId, until: iso });
    onClose();
  };

  return (
    <div
      ref={ref}
      className="dp-snooze-menu"
      style={{ left: anchor.left, top: anchor.top }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="row" onClick={() => pick(targets.tomorrow.iso)}>
        <span>Tomorrow</span>
        <span className="when">{targets.tomorrow.date}</span>
      </div>
      <div className="row" onClick={() => pick(targets.saturday.iso)}>
        <span>This Saturday</span>
        <span className="when">{targets.saturday.date}</span>
      </div>
      <div className="row" onClick={() => pick(targets.nextMonday.iso)}>
        <span>Next Monday</span>
        <span className="when">{targets.nextMonday.date}</span>
      </div>
      {isSnoozed && (
        <div className="row unsnooze" onClick={() => pick(null)}>
          <span>Unsnooze</span>
        </div>
      )}
    </div>
  );
}
