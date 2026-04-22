import type { Task } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function avatarColor(seed: string | undefined | null): string {
  if (!seed) return 'oklch(0.6 0.1 260)';
  return `oklch(0.6 0.12 ${hashHue(seed)})`;
}

function initialOf(name: string | undefined | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const delta = Math.round((that - today) / 86_400_000);
  const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
  const time = hasTime ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  if (delta < 0) {
    const abs = Math.abs(delta);
    return abs === 1 ? 'Overdue · 1 day' : `Overdue · ${abs} days`;
  }
  if (delta === 0) return time ? `Today · ${time}` : 'Due today';
  if (delta === 1) return time ? `Tomorrow · ${time}` : 'Due tomorrow';
  if (delta < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const PRIORITY_LABEL: Record<string, string | null> = {
  urgent: 'Urgent',
  high: 'High',
  normal: null,
  low: null,
  none: null,
};

export default function DashboardTaskRow({ task }: { task: Task }) {
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setActiveDashboardTab = usePMStore((s) => s.setActiveDashboardTab);

  const isDone = ((task as any).status as string | undefined) === 'done' || ((task as any).status as string | undefined) === 'closed';
  const firstAssignee = (task.assignees && task.assignees[0]) || null;
  const seed = firstAssignee?.display_name || firstAssignee?.email || task.id;
  const color = avatarColor(seed);
  const label = initialOf(firstAssignee?.display_name || firstAssignee?.email);
  const priorityLabel = PRIORITY_LABEL[task.priority as string] || null;
  const isSubtask = !!task.parent_task_id;
  const parentTitle = task.parent_task?.title || null;

  const onOpen = () => {
    setActiveDashboardTab(null);
    setActiveTask(task.id);
  };

  return (
    <div
      className="today-item"
      data-done={isDone}
      data-subtask={isSubtask || undefined}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={isSubtask ? { paddingLeft: 24 } : undefined}
    >
      <div className="checkbox" data-done={isDone} onClick={(e) => e.stopPropagation()} />
      <div>
        <div className="ti-title">
          {isSubtask && <span style={{ color: 'var(--sh-ink-4)', marginRight: 4 }}>↳</span>}
          {task.title}
        </div>
        <div className="ti-meta">
          {isSubtask && parentTitle && (
            <>
              <span style={{ color: 'var(--sh-ink-4)' }}>From: {parentTitle}</span>
              <span>·</span>
            </>
          )}
          <span>{formatWhen(task.due_date)}</span>
          {priorityLabel && (<><span>·</span><span>{priorityLabel}</span></>)}
          {firstAssignee?.display_name && (<><span>·</span><span>{firstAssignee.display_name}</span></>)}
        </div>
      </div>
      <div className="ava" style={{ width: 22, height: 22, borderRadius: '50%', background: color, fontSize: 9.5 }}>{label}</div>
    </div>
  );
}
