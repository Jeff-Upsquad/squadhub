import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { useMyTasks, useUpdateTask } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import { avatarColor, initialOf, formatWhen } from '../pm/taskHelpers';
import { groupTasks, isToday, type GroupBy } from '../../../lib/taskGrouping';

const STORAGE_KEY = 'squadhub:todayList:groupBy';
const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Due date' },
  { value: 'status', label: 'Status' },
  { value: 'space', label: 'Space' },
  { value: 'list', label: 'List' },
];

export default function TodayList() {
  const { data, isLoading, isError, refetch } = useMyTasks();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setActiveDashboardTab = usePMStore((s) => s.setActiveDashboardTab);
  const focusedTodayIds = usePMStore((s) => s.focusedTodayIds);
  const focusedTodayDate = usePMStore((s) => s.focusedTodayDate);

  const openTask = (id: string) => {
    setActiveDashboardTab(null);
    setActiveTask(id);
  };

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  // Show ONLY tasks the user has marked Focus today (★) or whose work_date is
  // today. The pmStore focus list auto-resets when the date rolls over.
  const tasks: Task[] = useMemo(() => {
    if (!data) return [];
    const all = [...data.overdue, ...data.today];
    const todayKey = new Date().toISOString().slice(0, 10);
    const focusedSet = focusedTodayDate === todayKey ? new Set(focusedTodayIds) : new Set<string>();
    return all.filter((t) => focusedSet.has(t.id) || isToday(t.work_date, tz));
  }, [data, focusedTodayIds, focusedTodayDate, tz]);

  const [groupBy, setGroupBy] = useState<GroupBy>(() => {
    if (typeof window === 'undefined') return 'none';
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const allowed = GROUP_OPTIONS.map((o) => o.value) as string[];
    return raw && allowed.includes(raw) ? (raw as GroupBy) : 'none';
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, groupBy); } catch { /* ignore */ }
  }, [groupBy]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const groups = useMemo(
    () => (groupBy === 'none' ? [] : groupTasks(tasks, groupBy, tz)),
    [tasks, groupBy, tz],
  );
  const currentLabel = GROUP_OPTIONS.find((o) => o.value === groupBy)?.label ?? 'None';

  return (
    <div className="card" style={{ marginBottom: 28 }}>
      <div className="card-head">
        <h3>Today — focus list</h3>
        <div ref={anchorRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="td-pill-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span style={{ color: 'var(--sh-ink-3)', marginRight: 2 }}>Group:</span>
            {currentLabel}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {menuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                minWidth: 160,
                background: 'var(--surface, #fff)',
                border: '1px solid var(--sh-hair-2, #eee)',
                borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                padding: 4,
                zIndex: 40,
                fontSize: 12.5,
              }}
            >
              {GROUP_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitem"
                  onClick={() => { setGroupBy(opt.value); setMenuOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: groupBy === opt.value ? 'var(--sh-hair-3)' : 'transparent',
                    color: 'var(--sh-ink)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: 'none',
                    font: 'inherit',
                  }}
                >
                  <span>{opt.label}</span>
                  {groupBy === opt.value && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="today-list">
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
        </div>
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

      {!isLoading && !isError && tasks.length > 0 && (
        groupBy === 'none' ? (
          <div className="today-list">
            {tasks.map((t) => (
              <TodayRow key={t.id} task={t} onOpen={openTask} />
            ))}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="today-group">
              <div className="today-group-head">
                <span>{g.label}</span>
                <span className="count">· {g.tasks.length}</span>
              </div>
              <div className="today-list">
                {g.tasks.map((t) => (
                  <TodayRow key={t.id} task={t} onOpen={openTask} />
                ))}
              </div>
            </div>
          ))
        )
      )}
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
