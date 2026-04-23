import { useState } from 'react';
import type { Task } from '@squadhub/shared';
import { useMyTasks, useUpdateTask } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import { avatarColor, initialOf, formatWhen } from '../pm/taskHelpers';

export default function TodayList() {
  const { data, isLoading, isError, refetch } = useMyTasks();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setActiveDashboardTab = usePMStore((s) => s.setActiveDashboardTab);

  const openTask = (id: string) => {
    setActiveDashboardTab(null);
    setActiveTask(id);
  };

  const tasks: Task[] = data ? [...data.overdue, ...data.today] : [];

  return (
    <div className="card" style={{ marginBottom: 28 }}>
      <div className="card-head">
        <h3>Today — focus list</h3>
        <span className="link">Reorder</span>
      </div>
      <div className="today-list">
        {isLoading && (
          <>
            {[0, 1, 2].map((i) => (
              <div key={i} className="today-item" style={{ opacity: 0.5 }}>
                <div className="checkbox" />
                <div>
                  <div className="ti-title" style={{ background: 'var(--sh-ink-6, #eee)', height: 12, borderRadius: 4, width: '60%' }} />
                  <div className="ti-meta" style={{ marginTop: 6 }}>
                    <span style={{ background: 'var(--sh-ink-6, #eee)', height: 10, borderRadius: 4, width: 80, display: 'inline-block' }} />
                  </div>
                </div>
                <div className="ava" style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--sh-ink-6, #eee)' }} />
              </div>
            ))}
          </>
        )}

        {isError && !isLoading && (
          <div style={{ padding: '18px 4px', textAlign: 'center', color: 'var(--sh-ink-4)' }}>
            Couldn't load today's list.{' '}
            <span className="link" style={{ cursor: 'pointer' }} onClick={() => refetch()}>Retry</span>
          </div>
        )}

        {!isLoading && !isError && tasks.length === 0 && (
          <div style={{ padding: '18px 4px', textAlign: 'center', color: 'var(--sh-ink-4)' }}>
            Nothing on the list for today.
          </div>
        )}

        {!isLoading && tasks.map((t) => (
          <TodayRow key={t.id} task={t} onOpen={openTask} />
        ))}
      </div>
    </div>
  );
}

function TodayRow({ task: t, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const updateTask = useUpdateTask(null);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isHidden, setIsHidden] = useState(false);

  const when = formatWhen(t.due_date);
  const assignee = t.assignees?.[0];
  const label = t.list?.name || t.space?.name || '';
  const isSubtask = !!t.parent_task_id;
  const parentTitle = t.parent_task?.title || null;
  const status = (t as any).status as string | undefined;
  const isDone = status === 'done' || status === 'closed';
  const displayDone = isDone || isFadingOut;

  const onToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = isDone ? 'todo' : 'done';
    if (!isDone) setIsFadingOut(true);
    updateTask.mutate(
      { id: t.id, status: next } as any,
      { onError: () => { setIsFadingOut(false); setIsHidden(false); } },
    );
  };

  const onRowTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName === 'transform' && isFadingOut) setIsHidden(true);
  };

  if (isHidden) return null;

  return (
    <div
      className="today-item"
      data-done={displayDone}
      data-fading={isFadingOut}
      data-subtask={isSubtask || undefined}
      onClick={() => onOpen(t.id)}
      onTransitionEnd={onRowTransitionEnd}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(t.id); } }}
      style={isSubtask ? { paddingLeft: 24 } : undefined}
    >
      <div
        className="checkbox"
        data-done={displayDone}
        data-celebrating={isFadingOut}
        role="button"
        aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
        onClick={onToggleDone}
      />
      <div>
        <div className="ti-title">
          {isSubtask && <span style={{ color: 'var(--sh-ink-4)', marginRight: 4 }}>↳</span>}
          {t.title}
        </div>
        <div className="ti-meta">
          {isSubtask && parentTitle && (
            <>
              <span style={{ color: 'var(--sh-ink-4)' }}>From: {parentTitle}</span>
              {(label || when.text) && <span>·</span>}
            </>
          )}
          {label && <span className="tag">{label}</span>}
          {label && when.text && <span>·</span>}
          {when.text && (
            <span style={when.state === 'overdue' ? { color: 'var(--sh-danger, #c43)' } : undefined}>
              {when.text}
            </span>
          )}
        </div>
      </div>
      {assignee ? (
        <div
          className="ava"
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: avatarColor(assignee.id || assignee.email),
            fontSize: 9.5,
          }}
          title={assignee.display_name || assignee.email}
        >
          {initialOf(assignee.display_name || assignee.email)}
        </div>
      ) : (
        <div
          className="ava"
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--sh-ink-6, #eee)',
            color: 'var(--sh-ink-4)',
            fontSize: 9.5,
          }}
          title="Unassigned"
        >
          –
        </div>
      )}
    </div>
  );
}
