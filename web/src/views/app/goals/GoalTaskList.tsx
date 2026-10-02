import { useMemo, useState, type CSSProperties } from 'react';
import type { Goal, GoalTask } from '@squadhub/shared';
import GoalIcon, { AvatarStack, type MemberLike } from './GoalIcons';
import { Popover } from './GoalFields';
import type { GoalActions } from './goalsApi';
import { onTimeline } from './GoalTimeline';
import { formatDay, formatRange, spaceColor, taskPath, taskRange, todayKey, toDayKey } from './goalUtils';

/** Every task in the goal as a list — open work first, then what's done. */
export default function GoalTaskList({ goal, members, actions, onOpenTask, onLinkTasks }: {
  goal: Goal;
  members: MemberLike[];
  actions: GoalActions;
  onOpenTask: (t: GoalTask) => void;
  onLinkTasks: () => void;
}) {
  const [menu, setMenu] = useState<{ task: GoalTask; rect: DOMRect } | null>(null);
  const [showDone, setShowDone] = useState(true);
  const today = todayKey();
  const { open, done } = useMemo(() => {
    const key = (t: GoalTask) => toDayKey(t.due_date) || taskRange(t, 'work')?.end || '9999';
    const sorted = [...goal.tasks].sort((a, b) => key(a).localeCompare(key(b)));
    return { open: sorted.filter((t) => !t.completed), done: sorted.filter((t) => t.completed) };
  }, [goal.tasks]);

  const row = (t: GoalTask) => {
    const work = taskRange(t, 'work');
    const due = toDayKey(t.due_date);
    const assignees = t.assignee_ids.map((id) => members.find((m) => m.id === id)).filter(Boolean) as MemberLike[];
    return (
      <div key={t.id} className="gl-list-row" data-done={t.completed || undefined} style={{ '--bar': spaceColor(t) } as CSSProperties}>
        <button type="button" className="gl-check" data-on={t.completed || undefined} disabled={!t.can_edit}
          aria-label={t.completed ? `Reopen ${t.title}` : `Complete ${t.title}`}
          onClick={() => void actions.setTaskCompleted(t, !t.completed).catch(() => undefined)}>
          <GoalIcon name="check" size={11} strokeWidth={3} />
        </button>
        <button type="button" className="gl-list-title" onClick={() => onOpenTask(t)}>
          <strong>{t.title}</strong>
          <small><i />{taskPath(t)}{!t.direct && t.source_ids.length ? ' · auto-included' : ''}</small>
        </button>
        <span className="gl-list-cell gl-list-work">{work ? formatRange(work.start, work.end) : <em>—</em>}</span>
        <span className="gl-list-cell" data-late={(!t.completed && !!due && due < today) || undefined}>{due ? formatDay(due) : <em>—</em>}</span>
        <span className="gl-list-cell gl-list-people"><AvatarStack members={assignees} size={22} max={3} /></span>
        <span className="gl-list-cell">
          <span className="gl-place" data-on={onTimeline(t) || undefined}>{onTimeline(t) ? 'Timeline' : 'Tray'}</span>
        </span>
        <button type="button" className="gl-icon-btn" aria-label={`More for ${t.title}`}
          onClick={(e) => setMenu({ task: t, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}>
          <GoalIcon name="more" size={16} />
        </button>
      </div>
    );
  };

  if (!goal.tasks.length) {
    return (
      <div className="gl-list-empty">
        <GoalIcon name="link" size={24} />
        <strong>No tasks linked yet</strong>
        <span>Search across every list you can access and link the work that moves this goal.</span>
        <button type="button" className="gl-btn gl-btn-primary" onClick={onLinkTasks}><GoalIcon name="link" size={14} />Link tasks</button>
      </div>
    );
  }

  return (
    <div className="gl-list">
      <div className="gl-list-head">
        <span>Task</span><span>Work dates</span><span>Due</span><span>People</span><span>Placed</span><span />
      </div>
      <div className="gl-list-group">
        <div className="gl-list-group-title">Open <span className="gl-count">{open.length}</span></div>
        {open.map(row)}
        {!open.length && <div className="gl-list-none">Nothing open — every task is done.</div>}
      </div>
      {done.length > 0 && (
        <div className="gl-list-group">
          <button type="button" className="gl-list-group-title" onClick={() => setShowDone(!showDone)}>
            <GoalIcon name="chevron" size={12} style={{ transform: showDone ? 'rotate(90deg)' : undefined }} />
            Done <span className="gl-count">{done.length}</span>
          </button>
          {showDone && done.map(row)}
        </div>
      )}
      <button type="button" className="gl-list-add" onClick={onLinkTasks}><GoalIcon name="plus" size={14} />Link more tasks</button>

      {menu && (
        <Popover anchor={menu.rect} onClose={() => setMenu(null)} width={230}>
          <button type="button" className="gl-pop-item" onClick={() => { setMenu(null); onOpenTask(menu.task); }}>
            <GoalIcon name="external" size={14} />Open task
          </button>
          <button type="button" className="gl-pop-item" onClick={() => {
            setMenu(null);
            void (onTimeline(menu.task)
              ? actions.schedule(goal.id, menu.task.id, { scheduled: false })
              : actions.place(goal.id, menu.task)).catch(() => undefined);
          }}>
            <GoalIcon name={onTimeline(menu.task) ? 'tray' : 'timeline'} size={14} />{onTimeline(menu.task) ? 'Move to tray' : 'Add to timeline'}
          </button>
          {menu.task.direct && (
            <button type="button" className="gl-pop-item gl-danger" onClick={() => {
              setMenu(null);
              void actions.unlinkTask(goal.id, menu.task).catch(() => undefined);
            }}>
              <GoalIcon name="unlink" size={14} />Remove from goal
            </button>
          )}
        </Popover>
      )}
    </div>
  );
}
