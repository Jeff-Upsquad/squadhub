import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Goal, GoalProject, GoalTask } from '@squadhub/shared';
import { useIsFetching } from '@tanstack/react-query';
import { usePMStore } from '../../../stores/pmStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useWorkspaceMembers } from '../../../hooks/useWorkspaceMembers';
import GoalIcon, { AvatarStack, ProgressRing, WavingFlag, type MemberLike } from './GoalIcons';
import { DateRangeField, LabelInput, MemberSelect, Popover, PriorityBadge, PrioritySelect, StatusSelect, useAnchor } from './GoalFields';
import GoalTimeline from './GoalTimeline';
import GoalTaskList from './GoalTaskList';
import { LinkTasksDialog, SourceDialog } from './GoalLinkDialog';
import { useGoal, useGoalActions, type GoalActions } from './goalsApi';
import { goalTabUrl, useGoalsUI } from './goalsStore';
import { daysBetween, formatDay, isGoalOverdue, relativeDay, todayKey, toDayKey } from './goalUtils';
import { useGoalDialogFocus } from './useGoalDialogFocus';

/** Hands Escape to whatever is on top (popovers, dialogs, the task panel) first. */
function somethingAbove() {
  const st = usePMStore.getState();
  if (st.activeTaskId || st.peekTaskId) return true;
  if (document.querySelector('.gl-pop, .gl-modal, .dp-panel, .nt-menu')) return true;
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export default function GoalDetail({ goalId, page }: { goalId: string; page: boolean }) {
  const openGoal = useGoalsUI((s) => s.openGoal);
  const { goal, project, isLoading, data } = useGoal(goalId, { live: true });
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useGoalDialogFocus(dialog);

  const close = () => {
    if (page) {
      // Standalone tab: land on the Goals page in this tab.
      openGoal(null);
      window.history.replaceState({}, '', '/app');
      useGoalsUI.getState().showGoalsView();
      return;
    }
    setClosing(true);
    setTimeout(() => openGoal(null), 170);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || page || somethingAbove()) return;
      close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  useEffect(() => {
    if (!goal) return;
    const prev = document.title;
    if (page) document.title = `${goal.name} · Goals`;
    return () => { if (page) document.title = prev; };
  }, [goal?.name, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = goal && project ? (
    <GoalSurface goal={goal} project={project} page={page} onClose={close} allLabels={data.goals.flatMap((g) => g.labels)} />
  ) : (
    <div className="gl-detail-missing">
      {isLoading ? <span className="gl-spinner gl-spinner-lg" /> : (
        <>
          <WavingFlag size={34} still />
          <strong>This goal isn’t available</strong>
          <span>It may have been deleted, or you don’t have access to it.</span>
          <button type="button" className="gl-btn" onClick={close}>Back to Goals</button>
        </>
      )}
    </div>
  );

  if (page) return <div ref={dialog} tabIndex={-1} className="gl-root gl-detail-page" aria-label={goal?.name || 'Goal'}>{body}</div>;
  return createPortal(
    <div className="gl-root gl-detail-overlay" data-closing={closing || undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !somethingAbove()) close(); }}>
      <div ref={dialog} tabIndex={-1} className="gl-detail" role="dialog" aria-modal="true" aria-label={goal?.name || 'Goal'}>{body}</div>
    </div>,
    document.body,
  );
}

function GoalSurface({ goal, project, page, onClose, allLabels }: {
  goal: Goal;
  project: GoalProject;
  page: boolean;
  onClose: () => void;
  allLabels: string[];
}) {
  const actions = useGoalActions();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const { data: members = [] } = useWorkspaceMembers(workspaceId);
  const fetching = useIsFetching({ queryKey: ['goals'] });
  const [tab, setTab] = useState<'timeline' | 'tasks'>('timeline');
  const [details, setDetails] = useState(() => typeof window === 'undefined' || window.innerWidth > 1180);
  const [linking, setLinking] = useState(false);
  const [sources, setSources] = useState(false);
  const color = project.color;
  const today = todayKey();
  const overdue = isGoalOverdue(goal, today);
  const assignees = goal.assignee_ids.map((id) => members.find((m) => m.id === id)).filter(Boolean) as MemberLike[];
  const openCount = goal.task_count - goal.completed_count;
  const lateTasks = goal.tasks.filter((t) => !t.completed && ((toDayKey(t.due_date) || '9999') < today)).length;
  const daysLeft = goal.due_date ? daysBetween(today, goal.due_date) : null;

  const openTask = (t: GoalTask) => usePMStore.getState().setActiveTask(t.id);

  return (
    <div className="gl-surface" style={{ '--gc': color } as CSSProperties} data-achieved={goal.status === 'achieved' || undefined}>
      <header className="gl-hero">
        <div className="gl-hero-bar">
          <button type="button" className="gl-crumb" onClick={onClose}>
            <WavingFlag size={15} color={color} still />Goals
          </button>
          <GoalIcon name="chevron" size={12} className="gl-crumb-sep" />
          <span className="gl-crumb gl-crumb-project"><i />{project.name}</span>
          <span className="gl-grow" />
          <span className="gl-sync" data-busy={fetching > 0 || undefined}>{fetching > 0 ? 'Syncing…' : 'Up to date'}</span>
          <button type="button" className="gl-chip-btn" data-active={details || undefined} onClick={() => setDetails(!details)}>
            <GoalIcon name="panel" size={15} />Details
          </button>
          {!page && (
            <button type="button" className="gl-icon-btn" title="Open in a new tab" aria-label="Open in a new tab"
              onClick={() => window.open(goalTabUrl(goal.id), '_blank', 'noopener')}>
              <GoalIcon name="expand" size={16} />
            </button>
          )}
          <button type="button" className="gl-icon-btn" onClick={onClose} aria-label={page ? 'Back to Goals' : 'Close goal'} title={page ? 'Back to Goals' : 'Close (Esc)'}>
            <GoalIcon name="close" size={18} />
          </button>
        </div>

        <div className="gl-hero-main">
          <div className="gl-hero-ring">
            <ProgressRing progress={goal.progress} size={96} stroke={8} color={color} done={goal.status === 'achieved'}>
              {goal.status === 'achieved'
                ? <span className="gl-hero-done"><GoalIcon name="check" size={30} strokeWidth={2.6} /></span>
                : <span className="gl-hero-pct">{goal.progress}<small>%</small></span>}
            </ProgressRing>
            <span className="gl-hero-ring-sub"><b>{goal.completed_count}</b> of {goal.task_count} done</span>
          </div>
          <div className="gl-hero-text">
            <InlineTitle value={goal.name} onSave={(name) => actions.updateGoal(goal.id, { name }).catch(() => undefined)} />
            <InlineDescription value={goal.description} onSave={(description) => actions.updateGoal(goal.id, { description }).catch(() => undefined)} />
            <div className="gl-hero-chips">
              <StatusSelect value={goal.stored_status} achieved={goal.status === 'achieved'} onChange={(status) => void actions.updateGoal(goal.id, { status }).catch(() => undefined)} />
              <PriorityBadge priority={goal.priority} />
              {goal.due_date && (
                <span className="gl-due" data-late={overdue || undefined}>
                  <GoalIcon name="calendar" size={13} />Due {formatDay(goal.due_date)}
                </span>
              )}
              {goal.labels.map((l) => <span key={l} className="gl-label">{l}</span>)}
              <AvatarStack members={assignees} size={24} max={4} />
            </div>
          </div>
          <div className="gl-hero-stats">
            <Stat label="Open" value={openCount} />
            <Stat label="Overdue" value={lateTasks} tone={lateTasks ? 'bad' : undefined} />
            <Stat label={daysLeft != null && daysLeft < 0 ? 'Days late' : 'Days left'} value={daysLeft == null ? '—' : Math.abs(daysLeft)} tone={daysLeft != null && daysLeft < 0 && goal.status !== 'achieved' ? 'bad' : undefined} />
          </div>
        </div>

        <nav className="gl-tabs-bar">
          <div className="gl-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'timeline'} data-active={tab === 'timeline' || undefined} onClick={() => setTab('timeline')}>
              <GoalIcon name="timeline" size={15} />Timeline
            </button>
            <button type="button" role="tab" aria-selected={tab === 'tasks'} data-active={tab === 'tasks' || undefined} onClick={() => setTab('tasks')}>
              <GoalIcon name="list" size={15} />Tasks<span className="gl-count">{goal.tasks.length}</span>
            </button>
          </div>
          <span className="gl-grow" />
          <button type="button" className="gl-btn gl-btn-primary gl-btn-sm" onClick={() => setLinking(true)}>
            <GoalIcon name="link" size={14} />Link tasks
          </button>
        </nav>
      </header>

      <div className="gl-detail-body" data-details={details || undefined}>
        <main className="gl-detail-main">
          {tab === 'timeline' ? (
            <GoalTimeline goal={goal} color={color} members={members} actions={actions} onOpenTask={openTask}
              onLinkTasks={() => setLinking(true)} onAddSource={() => setSources(true)} />
          ) : (
            <GoalTaskList goal={goal} members={members} actions={actions} onOpenTask={openTask} onLinkTasks={() => setLinking(true)} />
          )}
        </main>
        {details && (
          <GoalDetailsPanel goal={goal} project={project} members={members} actions={actions} allLabels={allLabels}
            onAddSource={() => setSources(true)} onDeleted={onClose} onClose={() => setDetails(false)} />
        )}
      </div>

      {linking && <LinkTasksDialog goal={goal} onClose={() => setLinking(false)} />}
      {sources && <SourceDialog goal={goal} onClose={() => setSources(false)} />}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'bad' }) {
  return (
    <div className="gl-stat" data-tone={tone}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function InlineTitle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (!v) { setDraft(value); return; }
    if (v !== value) onSave(v);
  };
  return (
    <input className="gl-hero-title" value={draft} maxLength={500} aria-label="Goal name"
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(value); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
      }} />
  );
}

function InlineDescription({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);
  return (
    <textarea ref={ref} className="gl-hero-desc" value={draft} rows={1} maxLength={20000} aria-label="Goal description"
      placeholder="Add a description — what does success look like?"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { setDraft(value); requestAnimationFrame(() => ref.current?.blur()); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ref.current?.blur();
      }} />
  );
}

function GoalDetailsPanel({ goal, project, members, actions, allLabels, onAddSource, onDeleted, onClose }: {
  goal: Goal;
  project: GoalProject;
  members: MemberLike[];
  actions: GoalActions;
  allLabels: string[];
  onAddSource: () => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const { data } = useGoal(goal.id);
  const projectMenu = useAnchor();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const creator = members.find((m) => m.id === goal.created_by);
  const suggestions = useMemo(() => [...new Set(allLabels)].sort(), [allLabels]);
  const update = (patch: Parameters<GoalActions['updateGoal']>[1]) => void actions.updateGoal(goal.id, patch).catch(() => undefined);
  const taskTitle = (id: string) => goal.tasks.find((t) => t.id === id)?.title || 'Task';

  return (
    <aside className="gl-details" aria-label="Goal details">
      <div className="gl-details-head">
        <strong>Details</strong>
        <button type="button" className="gl-icon-btn" onClick={onClose} aria-label="Hide details"><GoalIcon name="close" size={15} /></button>
      </div>
      <div className="gl-details-scroll">
        <section className="gl-details-section">
          <div className="gl-prop"><span>Status</span>
            <StatusSelect value={goal.stored_status} achieved={goal.status === 'achieved'} onChange={(status) => update({ status })} />
          </div>
          <div className="gl-prop"><span>Priority</span><PrioritySelect value={goal.priority} title={goal.name} onChange={(priority) => update({ priority })} /></div>
          <div className="gl-prop"><span>Assignees</span><MemberSelect members={members} value={goal.assignee_ids} onChange={(assignee_ids) => update({ assignee_ids })} /></div>
          <div className="gl-prop"><span>Labels</span><LabelInput value={goal.labels} suggestions={suggestions} onChange={(labels) => update({ labels })} /></div>
          <div className="gl-prop"><span>Project</span>
            <button type="button" className="gl-field-btn" onClick={projectMenu.open}>
              <span className="gl-dot" style={{ background: project.color }} /><span className="gl-field-text">{project.name}</span>
              <GoalIcon name="chevronDown" size={13} className="gl-field-caret" />
            </button>
          </div>
        </section>

        <section className="gl-details-section">
          <h4>Dates</h4>
          <div className="gl-prop gl-prop-stack"><span><i className="gl-key-work" />Work dates</span>
            <DateRangeField kind="work" start={goal.work_start_date} end={goal.work_end_date} startLabel="Work start" endLabel="Work end"
              onChange={(work_start_date, work_end_date) => update({ work_start_date, work_end_date })} />
          </div>
          <div className="gl-prop gl-prop-stack"><span><i className="gl-key-plan" />Start &amp; due</span>
            <DateRangeField kind="plan" start={goal.start_date} end={goal.due_date} startLabel="Start" endLabel="Due"
              onChange={(start_date, due_date) => update({ start_date, due_date })} />
          </div>
          {goal.due_date && goal.status !== 'achieved' && <p className="gl-details-note">Due {relativeDay(goal.due_date)}</p>}
        </section>

        <section className="gl-details-section">
          <h4>Auto-included <span className="gl-count">{goal.sources.length}</span></h4>
          {goal.sources.map((s) => (
            <div key={s.id} className="gl-mini-row">
              <GoalIcon name={s.resource_type === 'folder' ? 'folder' : 'list'} size={15} />
              <span><b>{s.name}</b><small>{s.path}</small></span>
              <button type="button" className="gl-icon-btn" aria-label={`Stop including ${s.name}`}
                onClick={() => void actions.removeSource(goal.id, s.id).catch(() => undefined)}>
                <GoalIcon name="close" size={13} />
              </button>
            </div>
          ))}
          <button type="button" className="gl-text-btn" onClick={onAddSource}><GoalIcon name="plus" size={13} />Include a folder or list</button>
        </section>

        <section className="gl-details-section">
          <h4>Dependencies <span className="gl-count">{goal.dependencies.length}</span></h4>
          {goal.dependencies.map((d) => (
            <div key={d.id} className="gl-mini-row gl-dep-row">
              <span><b>{taskTitle(d.from_task_id)}</b><small>{d.from_endpoint === 'end' ? 'finishes' : 'starts'}, then <b>{taskTitle(d.to_task_id)}</b> {d.to_endpoint === 'start' ? 'starts' : 'finishes'}</small></span>
              <button type="button" className="gl-icon-btn" aria-label="Remove dependency"
                onClick={() => void actions.removeDependency(goal.id, d.id).catch(() => undefined)}>
                <GoalIcon name="close" size={13} />
              </button>
            </div>
          ))}
          {!goal.dependencies.length && <p className="gl-details-note">Drag from a dot at either end of a timeline bar onto another task to connect them.</p>}
        </section>

        <section className="gl-details-section gl-details-meta">
          <p>Created {creator ? `by ${creator.display_name} ` : ''}on {formatDay(goal.created_at.slice(0, 10), { year: true })}</p>
          {confirmDelete ? (
            <div className="gl-confirm">
              <span>Delete this goal? Linked tasks stay where they are.</span>
              <div>
                <button type="button" className="gl-btn gl-btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button type="button" className="gl-btn gl-btn-sm gl-btn-danger" onClick={() => { onDeleted(); void actions.deleteGoal(goal.id).catch(() => undefined); }}>Delete</button>
              </div>
            </div>
          ) : (
            <button type="button" className="gl-text-btn gl-danger" onClick={() => setConfirmDelete(true)}><GoalIcon name="trash" size={13} />Delete goal</button>
          )}
        </section>
      </div>

      {projectMenu.anchor && (
        <Popover anchor={projectMenu.anchor} onClose={projectMenu.close} width={240}>
          <div className="gl-pop-title">Move to project</div>
          {data.projects.map((p) => (
            <button key={p.id} type="button" className="gl-pop-item" data-active={p.id === project.id || undefined}
              onClick={() => { projectMenu.close(); if (p.id !== project.id) update({ project_id: p.id }); }}>
              <span className="gl-dot" style={{ background: p.color }} /><span className="gl-pop-label">{p.name}</span>
              {p.id === project.id && <GoalIcon name="check" size={14} className="gl-pop-check" />}
            </button>
          ))}
        </Popover>
      )}
    </aside>
  );
}
