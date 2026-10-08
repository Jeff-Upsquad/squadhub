import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskPlan } from '@squadhub/shared';
import { TASK_PLANS, taskPlanOf, workDateForPlan } from '@squadhub/shared';
import { planMeta } from '../../../lib/stageWorkflow';

// Small chips used by stage-workflow views: the "Plan" chip (Today / Tomorrow /
// This week … derived from work_date) with its quick picker, and the automatic
// Overdue / Routine badges that nobody sets by hand.

const PICKABLE: TaskPlan[] = ['today', 'tomorrow', 'this_week', 'next_week', 'later', 'someday'];

function PlanPicker({
  anchorRect,
  value,
  onPick,
  onClose,
}: {
  anchorRect: DOMRect;
  value: TaskPlan;
  onPick: (workDate: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const width = 176;
  let left = anchorRect.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 260);

  return createPortal(
    <div ref={ref} className="nt-menu" style={{ position: 'fixed', top, left, width, zIndex: 160 }} onClick={(e) => e.stopPropagation()}>
      <div className="sw-menu-head">Plan to work on it…</div>
      {PICKABLE.map((p) => {
        const m = planMeta(p);
        return (
          <button
            key={p}
            type="button"
            className="nt-menu-item"
            data-active={p === value || undefined}
            onClick={() => { onPick(workDateForPlan(p)); onClose(); }}
          >
            <span className="nt-pri-dot" style={{ background: m.color, borderColor: m.color }} />
            {m.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export function PlanChip({
  workDate,
  tz,
  canEdit,
  onChange,
  hideSomeday = false,
}: {
  workDate: string | null | undefined;
  tz: string;
  canEdit: boolean;
  onChange: (workDate: string | null) => void;
  hideSomeday?: boolean;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const plan = taskPlanOf(workDate, tz);
  if (plan === 'someday' && hideSomeday && !canEdit) return null;
  const m = TASK_PLANS.find((p) => p.key === plan)!;
  const isEmpty = plan === 'someday';
  return (
    <>
      <button
        type="button"
        className="sw-chip"
        data-empty={isEmpty || undefined}
        style={isEmpty ? undefined : { color: m.color, background: `${m.color}1a`, borderColor: `${m.color}40` }}
        title={canEdit ? 'Change when you plan to work on this' : 'Planned for'}
        onClick={(e) => {
          e.stopPropagation();
          if (canEdit) setRect((e.currentTarget as HTMLElement).getBoundingClientRect());
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" />
        </svg>
        {isEmpty ? 'Plan' : m.label}
      </button>
      {rect && <PlanPicker anchorRect={rect} value={plan} onPick={onChange} onClose={() => setRect(null)} />}
    </>
  );
}

export function OverdueBadge() {
  return <span className="sw-chip sw-chip-danger" title="Due date has passed">Overdue</span>;
}

export function RoutineBadge() {
  return <span className="sw-chip sw-chip-muted" title="Created by a routine">↻ Routine</span>;
}
