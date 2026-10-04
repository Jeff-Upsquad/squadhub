import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTaskStatusCategory, type Goal, type GoalTask, type Task } from '@squadhub/shared';
import api from '../../../services/api';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useMyTasks, useTask } from '../../../hooks/useTasks';
import GoalIcon, { ProgressRing, WavingFlag } from './GoalIcons';
import { GoalModal } from './GoalCreateDialog';
import { useGoalActions, useGoalsData } from './goalsApi';
import { useGoalsUI } from './goalsStore';
import { STATUS_META, taskPath } from './goalUtils';

interface SearchHit {
  id: string;
  title: string;
  status: string;
  category: string | null;
  priority: string | null;
  due_date: string | null;
  work_date?: string | null;
  work_end_date?: string | null;
  start_date?: string | null;
  assignee_ids?: string[];
  parent_task_id?: string | null;
  display_number: number | null;
  list_id: string;
  list_name: string | null;
  folder_name: string | null;
  space_id: string | null;
  space_name: string | null;
  space_color?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Most-recent activity first: updated covers edits, created covers new tasks. */
function recentTime(t: { updated_at?: string | null; created_at?: string | null } | { updatedAt?: unknown }): number {
  const any = t as any;
  const updated = any.updated_at ?? any.updatedAt ?? null;
  const created = any.created_at ?? any.createdAt ?? null;
  const u = updated ? Date.parse(updated) : NaN;
  if (!Number.isNaN(u)) return u;
  const c = created ? Date.parse(created) : NaN;
  return Number.isNaN(c) ? 0 : c;
}

const isDone = (status: string, category?: string | null) => {
  const c = category || getTaskStatusCategory(status) || status?.toLowerCase();
  return c === 'done' || c === 'closed';
};

/** Shape a search hit / task like a goal task so it can appear instantly. */
export function asGoalTask(t: SearchHit | Task): GoalTask {
  const any = t as any;
  const status: string = typeof any.status === 'string' ? any.status : any.status?.name ?? '';
  return {
    id: t.id,
    title: t.title,
    status,
    completed: isDone(status, any.category),
    priority: (t.priority as string) ?? null,
    display_number: any.display_number ?? null,
    parent_task_id: any.parent_task_id ?? null,
    list_id: t.list_id,
    list_name: any.list_name ?? any.list?.name ?? '',
    folder_name: any.folder_name ?? null,
    space_id: any.space_id ?? '',
    space_name: any.space_name ?? any.space?.name ?? '',
    space_color: any.space_color ?? null,
    assignee_ids: any.assignee_ids ?? [],
    work_date: any.work_date ?? null,
    work_end_date: any.work_end_date ?? any.metadata?.work_end_date ?? null,
    start_date: any.start_date ?? null,
    due_date: t.due_date ?? null,
    scheduled: !!(any.work_date || any.start_date || t.due_date),
    can_edit: true,
    direct: true,
    source_ids: [],
  };
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Search tasks across the workspace and link them to a goal (⌘K-style). */
export function LinkTasksDialog({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const actions = useGoalActions();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const query = useDebounced(q.trim(), 160);
  const listRef = useRef<HTMLDivElement>(null);

  const search = useQuery<SearchHit[]>({
    queryKey: ['goal-link-search', workspaceId, query],
    queryFn: async () => (await api.get('/pm/search', { params: { workspace_id: workspaceId, q: query, limit: 40, include_subtasks: true } })).data.data.tasks,
    enabled: !!workspaceId && query.length > 0,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
  const { data: mine } = useMyTasks();
  const suggestions = useMemo(() => {
    if (!mine) return [] as GoalTask[];
    const seen = new Set<string>();
    const collected: Task[] = [];
    for (const b of ['focused', 'overdue', 'today', 'tomorrow', 'upcoming', 'later'] as const) {
      for (const t of mine[b] || []) {
        if (seen.has(t.id) || t.recurrence) continue;
        seen.add(t.id);
        collected.push(t);
      }
    }
    // Most recently added and updated first — not due-date bucket order.
    collected.sort((a, b) => recentTime(b) - recentTime(a));
    const out: GoalTask[] = [];
    for (const t of collected) {
      const g = asGoalTask(t);
      if (!g.completed) {
        out.push(g);
        if (out.length >= 14) break;
      }
    }
    return out;
  }, [mine]);

  const results: GoalTask[] = useMemo(() => {
    if (!query) return suggestions;
    // Server already orders by updated_at DESC; re-sort defensively so cached
    // or mixed responses still show most recently added/updated first.
    const hits = [...(search.data || [])].sort((a, b) => recentTime(b) - recentTime(a));
    return hits.map(asGoalTask);
  }, [query, search.data, suggestions]);
  const linked = new Map(goal.tasks.map((t) => [t.id, t]));

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  async function toggle(t: GoalTask) {
    if (busy.has(t.id)) return;
    const existing = linked.get(t.id);
    if (existing && !existing.direct) return;
    setBusy((b) => new Set(b).add(t.id));
    try {
      if (existing) await actions.unlinkTask(goal.id, existing);
      else await actions.linkTasks(goal.id, [t]);
    } catch { /* toast shown by actions */ } finally {
      setBusy((b) => { const n = new Set(b); n.delete(t.id); return n; });
    }
  }

  return (
    <GoalModal onClose={onClose} className="gl-palette" labelledBy="gl-link-title">
      <h2 id="gl-link-title" className="gl-sr">Link tasks to {goal.name}</h2>
      <label className="gl-palette-search">
        <GoalIcon name="search" size={18} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tasks across your workspace…"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter' && results[active]) { e.preventDefault(); void toggle(results[active]); }
          }}
        />
        {search.isFetching && <span className="gl-spinner" aria-label="Searching" />}
        <kbd className="gl-kbd">esc</kbd>
      </label>
      <div className="gl-palette-meta">
        <span>{query ? 'Results' : 'Your open tasks'}</span>
        <span className="gl-palette-count"><WavingFlag size={13} still color="var(--gc)" />{goal.task_count} linked to this goal</span>
      </div>
      <div className="gl-palette-list" ref={listRef}>
        {results.map((t, i) => {
          const link = linked.get(t.id);
          const viaSource = link && !link.direct;
          return (
            <button
              key={t.id}
              type="button"
              data-index={i}
              className="gl-palette-row"
              data-active={i === active || undefined}
              data-linked={!!link || undefined}
              onMouseMove={() => setActive(i)}
              onClick={() => void toggle(t)}
              disabled={viaSource}
            >
              <span className="gl-task-dot" data-done={t.completed || undefined} />
              <span className="gl-palette-text">
                <strong>{t.title}</strong>
                <small>{taskPath(t)}{t.parent_task_id ? ' · subtask' : ''}</small>
              </span>
              {viaSource ? (
                <span className="gl-palette-state">Auto-included</span>
              ) : busy.has(t.id) ? (
                <span className="gl-spinner" />
              ) : link ? (
                <span className="gl-palette-state gl-palette-on"><GoalIcon name="check" size={13} strokeWidth={2.4} />Linked</span>
              ) : (
                <span className="gl-palette-state gl-palette-add"><GoalIcon name="plus" size={13} strokeWidth={2.2} />Link</span>
              )}
            </button>
          );
        })}
        {query && !search.isFetching && search.data && !results.length && (
          <div className="gl-palette-empty">
            <GoalIcon name="search" size={22} />
            <strong>No tasks match “{query}”</strong>
            <span>Only tasks you and the goal’s creator can open are searchable.</span>
          </div>
        )}
        {!query && !results.length && (
          <div className="gl-palette-empty">
            <GoalIcon name="sparkle" size={22} />
            <strong>Find the work that moves this goal</strong>
            <span>Type to search every task you have access to — including subtasks.</span>
          </div>
        )}
      </div>
      <footer className="gl-palette-foot">
        <span><kbd className="gl-kbd">↑</kbd><kbd className="gl-kbd">↓</kbd> move</span>
        <span><kbd className="gl-kbd">↵</kbd> link / unlink</span>
        <button type="button" className="gl-btn gl-btn-primary gl-btn-sm" onClick={onClose}>Done</button>
      </footer>
    </GoalModal>
  );
}

/** "Add to a goal" — opened from a task's ⋯ menu. */
export function PickGoalDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { data } = useGoalsData();
  const { data: task } = useTask(taskId);
  const actions = useGoalActions();
  const startCreate = useGoalsUI((s) => s.startCreate);
  const openGoal = useGoalsUI((s) => s.openGoal);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const goals = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.goals
      .filter((g) => !needle || g.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(a.status === 'achieved') - Number(b.status === 'achieved'));
  }, [data.goals, q]);

  async function toggle(g: Goal) {
    const existing = g.tasks.find((t) => t.id === taskId);
    if (existing && !existing.direct) return;
    if (!existing && !task) return;
    setBusy(g.id);
    try {
      if (existing) await actions.unlinkTask(g.id, existing);
      else await actions.linkTasks(g.id, [asGoalTask(task as Task)]);
    } catch { /* toast shown by actions */ } finally {
      setBusy(null);
    }
  }

  return (
    <GoalModal onClose={onClose} className="gl-pick" labelledBy="gl-pick-title">
      <header className="gl-pick-head">
        <span className="gl-flag-tile"><WavingFlag size={22} /></span>
        <div>
          <h2 id="gl-pick-title">Add to a goal</h2>
          <p>{task?.title || 'Loading task…'}</p>
        </div>
        <button type="button" className="gl-icon-btn" onClick={onClose} aria-label="Close"><GoalIcon name="close" size={18} /></button>
      </header>
      <label className="gl-pop-search gl-pick-search">
        <GoalIcon name="search" size={15} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a goal…" />
      </label>
      <div className="gl-pick-list">
        {goals.map((g) => {
          const project = data.projects.find((p) => p.id === g.project_id);
          const link = g.tasks.find((t) => t.id === taskId);
          return (
            <div key={g.id} className="gl-pick-row" style={{ '--gc': project?.color } as React.CSSProperties} data-linked={!!link || undefined}>
              <ProgressRing progress={g.progress} size={34} stroke={3.5} color="var(--gc)" done={g.status === 'achieved'}>
                {g.status === 'achieved' ? <GoalIcon name="check" size={13} strokeWidth={2.6} /> : <small>{g.progress}</small>}
              </ProgressRing>
              <button type="button" className="gl-pick-text" onClick={() => { onClose(); openGoal(g.id); }}>
                <strong>{g.name}</strong>
                <small><i style={{ background: project?.color }} />{project?.name} · {STATUS_META[g.status].label}</small>
              </button>
              <button type="button" className={`gl-btn gl-btn-sm ${link ? 'gl-btn-linked' : ''}`}
                disabled={busy === g.id || (!!link && !link.direct) || (!link && !task)} onClick={() => void toggle(g)}>
                {link && !link.direct ? 'Auto-included' : link ? <><GoalIcon name="check" size={13} strokeWidth={2.4} />Added</> : busy === g.id ? 'Adding…' : <><GoalIcon name="plus" size={13} />Add</>}
              </button>
            </div>
          );
        })}
        {!goals.length && (
          <div className="gl-palette-empty">
            <WavingFlag size={26} />
            <strong>{q ? 'No goals match' : 'No goals yet'}</strong>
            <span>Create one and this task will be linked to it.</span>
          </div>
        )}
      </div>
      <footer className="gl-pick-foot">
        <button type="button" className="gl-btn gl-btn-ghost" onClick={() => { onClose(); startCreate({ taskIds: [taskId] }); }}>
          <GoalIcon name="plus" size={14} />New goal with this task
        </button>
        <button type="button" className="gl-btn gl-btn-primary gl-btn-sm" onClick={onClose}>Done</button>
      </footer>
    </GoalModal>
  );
}

interface Container { type: 'folder' | 'list'; id: string; name: string; path: string }

/** Auto-include every task in a folder or list (incl. tasks added later). */
export function SourceDialog({ goal, onClose, preselect }: {
  goal: Goal | null;
  onClose: () => void;
  preselect?: { type: 'folder' | 'list'; id: string; name: string };
}) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const actions = useGoalActions();
  const { data } = useGoalsData();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const containers = useQuery<Container[]>({
    queryKey: ['goal-containers', workspaceId],
    queryFn: async () => (await api.get('/pm/goals-containers', { params: { workspace_id: workspaceId } })).data.data,
    enabled: !!workspaceId && !preselect,
    staleTime: 60_000,
  });
  const needle = q.trim().toLowerCase();

  // Choosing a container for a goal…
  if (goal) {
    const items = (containers.data || []).filter((c) => !needle || `${c.name} ${c.path}`.toLowerCase().includes(needle));
    return (
      <GoalModal onClose={onClose} className="gl-pick" labelledBy="gl-src-title">
        <header className="gl-pick-head">
          <span className="gl-flag-tile"><GoalIcon name="folder" size={20} /></span>
          <div>
            <h2 id="gl-src-title">Auto-include a folder or list</h2>
            <p>Every task inside counts toward this goal — including tasks added later.</p>
          </div>
          <button type="button" className="gl-icon-btn" onClick={onClose} aria-label="Close"><GoalIcon name="close" size={18} /></button>
        </header>
        <label className="gl-pop-search gl-pick-search">
          <GoalIcon name="search" size={15} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a folder or list…" />
        </label>
        <div className="gl-pick-list">
          {containers.isLoading && <div className="gl-pick-loading"><span className="gl-spinner" /></div>}
          {items.map((c) => {
            const on = goal.sources.some((s) => s.resource_type === c.type && s.resource_id === c.id);
            return (
              <div key={c.type + c.id} className="gl-pick-row">
                <span className="gl-src-icon"><GoalIcon name={c.type === 'folder' ? 'folder' : 'list'} size={16} /></span>
                <span className="gl-pick-text"><strong>{c.name}</strong><small>{c.path} · {c.type}</small></span>
                <button type="button" className={`gl-btn gl-btn-sm ${on ? 'gl-btn-linked' : ''}`} disabled={on || busy === c.id}
                  onClick={async () => { setBusy(c.id); try { await actions.addSource(goal.id, { resource_type: c.type, resource_id: c.id }); } catch { /* toasted */ } finally { setBusy(null); } }}>
                  {on ? <><GoalIcon name="check" size={13} strokeWidth={2.4} />Included</> : busy === c.id ? 'Adding…' : 'Include'}
                </button>
              </div>
            );
          })}
          {!containers.isLoading && !items.length && <div className="gl-palette-empty"><strong>Nothing matches</strong></div>}
        </div>
      </GoalModal>
    );
  }

  // …or choosing a goal for a container (from folder/list settings).
  const goals = data.goals.filter((g) => !needle || g.name.toLowerCase().includes(needle));
  return (
    <GoalModal onClose={onClose} className="gl-pick" labelledBy="gl-src-title">
      <header className="gl-pick-head">
        <span className="gl-flag-tile"><WavingFlag size={22} /></span>
        <div>
          <h2 id="gl-src-title">Count “{preselect?.name}” toward a goal</h2>
          <p>All of its tasks — now and later — will be part of the goal you pick.</p>
        </div>
        <button type="button" className="gl-icon-btn" onClick={onClose} aria-label="Close"><GoalIcon name="close" size={18} /></button>
      </header>
      <label className="gl-pop-search gl-pick-search">
        <GoalIcon name="search" size={15} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a goal…" />
      </label>
      <div className="gl-pick-list">
        {goals.map((g) => {
          const project = data.projects.find((p) => p.id === g.project_id);
          const on = g.sources.some((s) => s.resource_type === preselect?.type && s.resource_id === preselect?.id);
          return (
            <div key={g.id} className="gl-pick-row" style={{ '--gc': project?.color } as React.CSSProperties}>
              <ProgressRing progress={g.progress} size={34} stroke={3.5} color="var(--gc)"><small>{g.progress}</small></ProgressRing>
              <span className="gl-pick-text"><strong>{g.name}</strong><small><i style={{ background: project?.color }} />{project?.name}</small></span>
              <button type="button" className={`gl-btn gl-btn-sm ${on ? 'gl-btn-linked' : ''}`} disabled={on || busy === g.id}
                onClick={async () => { if (!preselect) return; setBusy(g.id); try { await actions.addSource(g.id, { resource_type: preselect.type, resource_id: preselect.id }); } catch { /* toasted */ } finally { setBusy(null); } }}>
                {on ? <><GoalIcon name="check" size={13} strokeWidth={2.4} />Included</> : busy === g.id ? 'Adding…' : 'Include'}
              </button>
            </div>
          );
        })}
        {!goals.length && <div className="gl-palette-empty"><strong>No goals yet</strong><span>Create a goal in Goals first.</span></div>}
      </div>
    </GoalModal>
  );
}
