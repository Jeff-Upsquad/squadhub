import { useMemo, useState, type CSSProperties } from 'react';
import type { Goal, GoalProject } from '@squadhub/shared';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useWorkspaceMembers } from '../../../hooks/useWorkspaceMembers';
import GoalIcon, { AvatarStack, ProgressRing, SegmentBar, WavingFlag, type MemberLike } from './GoalIcons';
import { Popover, PriorityBadge, StatusPill, useAnchor } from './GoalFields';
import { ColorSwatches, GoalModal } from './GoalCreateDialog';
import { useGoalActions, useGoalsData } from './goalsApi';
import { goalTabUrl, useGoalsUI } from './goalsStore';
import {
  PRIORITY_META, PROJECT_COLORS, STATUS_META, daysBetween, formatDay, isGoalInMotion, isGoalOverdue, todayKey,
} from './goalUtils';

type Filter = 'active' | 'achieved' | 'all';
type GroupBy = 'project' | 'status' | 'priority' | 'due' | 'assignee' | 'none';
type Layout = 'cards' | 'list';

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'none', label: 'None' },
];

function usePref<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      return s && allowed.includes(s) ? s : fallback;
    } catch { return fallback; }
  });
  return [v, (next: T) => { setV(next); try { localStorage.setItem(key, next); } catch { /* private mode */ } }];
}

interface Group { key: string; label: string; color?: string; project?: GoalProject; goals: Goal[] }

export default function GoalsView() {
  const { data, isLoading, error, refetch } = useGoalsData({ live: true });
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const { data: members = [] } = useWorkspaceMembers(workspaceId);
  const startCreate = useGoalsUI((s) => s.startCreate);
  const openGoal = useGoalsUI((s) => s.openGoal);
  const [filter, setFilter] = usePref<Filter>('gl-filter', ['active', 'achieved', 'all'] as const, 'active');
  const [groupBy, setGroupBy] = usePref<GroupBy>('gl-group', ['project', 'status', 'priority', 'due', 'assignee', 'none'] as const, 'project');
  const [layout, setLayout] = usePref<Layout>('gl-layout', ['cards', 'list'] as const, 'cards');
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editProject, setEditProject] = useState<GoalProject | 'new' | null>(null);
  const groupMenu = useAnchor();
  const today = todayKey();

  const projectById = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const stats = useMemo(() => {
    const active = data.goals.filter((g) => g.status !== 'achieved');
    const tasks = data.goals.reduce((s, g) => s + g.task_count, 0);
    const done = data.goals.reduce((s, g) => s + g.completed_count, 0);
    return {
      inMotion: active.filter((g) => isGoalInMotion(g, today)).length,
      active: active.length,
      achieved: data.goals.length - active.length,
      tasks,
      done,
      dueSoon: active.filter((g) => g.due_date && g.due_date >= today && daysBetween(today, g.due_date) <= 7).length,
      overdue: active.filter((g) => isGoalOverdue(g, today)).length,
    };
  }, [data.goals, today]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.goals.filter((g) => {
      if (filter === 'active' && g.status === 'achieved') return false;
      if (filter === 'achieved' && g.status !== 'achieved') return false;
      if (!needle) return true;
      return `${g.name} ${g.description} ${g.labels.join(' ')} ${projectById.get(g.project_id)?.name || ''}`.toLowerCase().includes(needle);
    });
  }, [data.goals, filter, q, projectById]);

  const groups = useMemo<Group[]>(() => {
    const byDue = (a: Goal, b: Goal) => (a.due_date || '9999').localeCompare(b.due_date || '9999');
    const sorted = [...filtered].sort(byDue);
    if (groupBy === 'none') return [{ key: 'all', label: 'All goals', goals: sorted }];
    const map = new Map<string, Group>();
    const add = (key: string, label: string, g: Goal | null, extra: Partial<Group> = {}) => {
      if (!map.has(key)) map.set(key, { key, label, goals: [], ...extra });
      if (g) map.get(key)!.goals.push(g);
    };
    if (groupBy === 'project') {
      // Show every project (even empty) when not searching, so it's easy to add to one.
      if (!q.trim() && filter !== 'achieved') for (const p of data.projects) add(p.id, p.name, null, { color: p.color, project: p });
      for (const g of sorted) {
        const p = projectById.get(g.project_id);
        add(g.project_id, p?.name || 'Project', g, { color: p?.color, project: p });
      }
      return [...map.values()];
    }
    for (const g of sorted) {
      if (groupBy === 'status') add(g.status, STATUS_META[g.status].label, g, { color: STATUS_META[g.status].color });
      if (groupBy === 'priority') add(g.priority, PRIORITY_META[g.priority].label, g, { color: PRIORITY_META[g.priority].color });
      if (groupBy === 'due') {
        const d = g.due_date;
        const [k, l] = g.status === 'achieved' ? ['5', 'Achieved']
          : !d ? ['6', 'No due date']
          : d < today ? ['0', 'Overdue']
          : daysBetween(today, d) <= 7 ? ['1', 'Due this week']
          : d.slice(0, 7) === today.slice(0, 7) ? ['2', 'Later this month']
          : daysBetween(today, d) <= 92 ? ['3', 'Next 3 months'] : ['4', 'Later'];
        add(k, l, g, { color: k === '0' ? '#ef4444' : k === '1' ? '#f08c00' : k === '5' ? STATUS_META.achieved.color : undefined });
      }
      if (groupBy === 'assignee') {
        if (!g.assignee_ids.length) add('~none', 'Unassigned', g);
        for (const id of g.assignee_ids) add(id, memberById.get(id)?.display_name || 'Someone', g);
      }
    }
    const order: Record<GroupBy, (a: Group, b: Group) => number> = {
      project: () => 0,
      none: () => 0,
      status: (a, b) => ['in_progress', 'planned', 'on_hold', 'achieved'].indexOf(a.key) - ['in_progress', 'planned', 'on_hold', 'achieved'].indexOf(b.key),
      priority: (a, b) => PRIORITY_META[a.key as Goal['priority']].rank - PRIORITY_META[b.key as Goal['priority']].rank,
      due: (a, b) => a.key.localeCompare(b.key),
      assignee: (a, b) => (a.key === '~none' ? 1 : b.key === '~none' ? -1 : a.label.localeCompare(b.label)),
    };
    return [...map.values()].sort(order[groupBy]);
  }, [filtered, groupBy, q, filter, data.projects, projectById, memberById, today]);

  const toggleGroup = (key: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const empty = !isLoading && !error && data.goals.length === 0;

  return (
    <div className="gl-root gl-page sh-view">
      <div className="gl-page-inner">
        <header className="gl-page-head">
          <div className="gl-page-title">
            <span className="gl-flag-tile gl-flag-tile-lg"><WavingFlag size={34} color="#ff6b4a" /></span>
            <div>
              <h1>Goals</h1>
              <p>{stats.active
                ? <>{stats.inMotion} in motion · {stats.achieved} achieved · <b>{stats.tasks ? Math.round((stats.done / stats.tasks) * 100) : 0}%</b> of linked work done</>
                : 'Set an outcome, link the work, and watch it come together.'}</p>
            </div>
          </div>
          <div className="gl-page-actions">
            <button type="button" className="gl-btn" onClick={() => setEditProject('new')}><GoalIcon name="folder" size={15} />New project</button>
            <button type="button" className="gl-btn gl-btn-primary" onClick={() => startCreate({})}><GoalIcon name="plus" size={15} />New goal</button>
          </div>
        </header>

        {!empty && (
          <div className="gl-tiles">
            <div className="gl-tile gl-tile-dark">
              <ProgressRing progress={stats.tasks ? Math.round((stats.done / stats.tasks) * 100) : 0} size={58} stroke={6} color="#ff8a5c">
                <b className="gl-tile-ringval">{stats.tasks ? Math.round((stats.done / stats.tasks) * 100) : 0}<small>%</small></b>
              </ProgressRing>
              <div><span>Linked work done</span><b>{stats.done}<small> / {stats.tasks} tasks</small></b></div>
            </div>
            <div className="gl-tile"><span><WavingFlag size={14} color="#2f7cf6" still />In motion</span><b>{stats.inMotion}</b><small>{stats.active} active in total</small></div>
            <div className="gl-tile"><span><GoalIcon name="check" size={14} />Achieved</span><b>{stats.achieved}</b><small>Every task done</small></div>
            <div className="gl-tile" data-alert={stats.overdue > 0 || undefined}>
              <span><GoalIcon name="calendar" size={14} />Due soon</span><b>{stats.dueSoon}</b>
              <small>{stats.overdue ? <em>{stats.overdue} overdue</em> : 'Next 7 days'}</small>
            </div>
          </div>
        )}

        {!empty && (
          <div className="gl-toolbar">
            <div className="gl-seg gl-seg-lg" role="radiogroup" aria-label="Show">
              {([['active', 'Active', stats.active], ['achieved', 'Achieved', stats.achieved], ['all', 'All', data.goals.length]] as const).map(([k, l, n]) => (
                <button key={k} type="button" role="radio" aria-checked={filter === k} data-active={filter === k || undefined} onClick={() => setFilter(k)}>
                  {l}<span className="gl-count">{n}</span>
                </button>
              ))}
            </div>
            <span className="gl-grow" />
            <label className="gl-search">
              <GoalIcon name="search" size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search goals" aria-label="Search goals" />
              {q && <button type="button" className="gl-icon-btn" onClick={() => setQ('')} aria-label="Clear search"><GoalIcon name="close" size={12} /></button>}
            </label>
            <button type="button" className="gl-chip-btn" onClick={groupMenu.open}>
              <GoalIcon name="rows" size={14} />Group: <b>{GROUPS.find((g) => g.value === groupBy)?.label}</b><GoalIcon name="chevronDown" size={12} />
            </button>
            <div className="gl-seg" role="radiogroup" aria-label="Layout">
              <button type="button" role="radio" aria-checked={layout === 'cards'} data-active={layout === 'cards' || undefined} onClick={() => setLayout('cards')} title="Cards"><GoalIcon name="grid" size={15} /></button>
              <button type="button" role="radio" aria-checked={layout === 'list'} data-active={layout === 'list' || undefined} onClick={() => setLayout('list')} title="List"><GoalIcon name="list" size={15} /></button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="gl-cards">{[0, 1, 2].map((i) => <div key={i} className="gl-card gl-skeleton" style={{ animationDelay: `${i * 90}ms` }} />)}</div>
        ) : error ? (
          <div className="gl-empty">
            <WavingFlag size={36} still />
            <h3>Goals couldn’t load</h3>
            <p>Check your connection and try again.</p>
            <button type="button" className="gl-btn" onClick={() => void refetch()}>Try again</button>
          </div>
        ) : empty ? (
          <EmptyHero onCreate={() => startCreate({})} />
        ) : (
          <>
            {groups.map((group, gi) => {
              const isCollapsed = collapsed.has(group.key);
              const done = group.goals.reduce((s, g) => s + g.completed_count, 0);
              const total = group.goals.reduce((s, g) => s + g.task_count, 0);
              return (
                <section key={group.key} className="gl-group" style={{ '--gc': group.color || 'var(--sh-ink-3)', animationDelay: `${gi * 45}ms` } as CSSProperties}>
                  {groupBy !== 'none' && (
                    <div className="gl-group-head">
                      <button type="button" className="gl-group-toggle" onClick={() => toggleGroup(group.key)} aria-expanded={!isCollapsed}>
                        <GoalIcon name="chevron" size={13} className="gl-group-caret" style={{ transform: isCollapsed ? undefined : 'rotate(90deg)' }} />
                        <i className="gl-group-dot" />
                        <h2>{group.label}</h2>
                        <span className="gl-count">{group.goals.length}</span>
                      </button>
                      {total > 0 && (
                        <span className="gl-group-progress"><span style={{ width: `${(done / total) * 100}%` }} /></span>
                      )}
                      {total > 0 && <small className="gl-group-meta">{Math.round((done / total) * 100)}% · {done}/{total} tasks</small>}
                      <span className="gl-grow" />
                      {group.project && (
                        <>
                          <button type="button" className="gl-text-btn" onClick={() => startCreate({ projectId: group.project!.id })}><GoalIcon name="plus" size={13} />Goal</button>
                          <button type="button" className="gl-icon-btn" aria-label={`Edit ${group.label}`} onClick={() => setEditProject(group.project!)}>
                            <GoalIcon name="edit" size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {!isCollapsed && (
                    layout === 'cards' ? (
                      <div className="gl-cards">
                        {group.goals.map((g, i) => (
                          <GoalCard key={g.id} goal={g} project={projectById.get(g.project_id)} memberById={memberById} index={i} onOpen={() => openGoal(g.id)} />
                        ))}
                        {group.project && !group.goals.length && (
                          <button type="button" className="gl-card gl-card-add" onClick={() => startCreate({ projectId: group.project!.id })}>
                            <GoalIcon name="plus" size={20} /><span>Add the first goal to {group.label}</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="gl-rows">
                        {group.goals.map((g) => (
                          <GoalRow key={g.id} goal={g} project={projectById.get(g.project_id)} memberById={memberById} onOpen={() => openGoal(g.id)} />
                        ))}
                        {group.project && !group.goals.length && <div className="gl-rows-empty">No goals in this project yet.</div>}
                      </div>
                    )
                  )}
                </section>
              );
            })}
            {!groups.some((g) => g.goals.length) && (
              <div className="gl-empty gl-empty-sm">
                <GoalIcon name="search" size={24} />
                <h3>{q ? `Nothing matches “${q}”` : filter === 'achieved' ? 'No achieved goals yet' : 'No active goals'}</h3>
                <p>{filter === 'achieved' ? 'A goal is achieved the moment its last task is done.' : 'Try another filter or create a goal.'}</p>
              </div>
            )}
          </>
        )}
      </div>

      {groupMenu.anchor && (
        <Popover anchor={groupMenu.anchor} onClose={groupMenu.close} width={200}>
          <div className="gl-pop-title">Group by</div>
          {GROUPS.map((g) => (
            <button key={g.value} type="button" className="gl-pop-item" data-active={groupBy === g.value || undefined}
              onClick={() => { setGroupBy(g.value); groupMenu.close(); }}>
              <span className="gl-pop-label">{g.label}</span>
              {groupBy === g.value && <GoalIcon name="check" size={14} className="gl-pop-check" />}
            </button>
          ))}
        </Popover>
      )}
      {editProject && <ProjectDialog project={editProject === 'new' ? null : editProject} count={editProject === 'new' ? 0 : data.goals.filter((g) => g.project_id === editProject.id).length} onClose={() => setEditProject(null)} />}
    </div>
  );
}

function dueChip(g: Goal, today: string) {
  if (!g.due_date || g.status === 'achieved') return null;
  const n = daysBetween(today, g.due_date);
  const tone = n < 0 ? 'late' : n <= 3 ? 'soon' : undefined;
  const text = n < 0 ? `${-n}d overdue` : n === 0 ? 'Due today' : n <= 14 ? `${n}d left` : formatDay(g.due_date);
  return <span className="gl-due" data-tone={tone}><GoalIcon name="calendar" size={12} />{text}</span>;
}

function GoalCard({ goal: g, project, memberById, index, onOpen }: {
  goal: Goal;
  project?: GoalProject;
  memberById: Map<string, MemberLike>;
  index: number;
  onOpen: () => void;
}) {
  const menu = useAnchor();
  const actions = useGoalActions();
  const today = todayKey();
  const color = project?.color || '#7c5cff';
  const achieved = g.status === 'achieved';
  const people = g.assignee_ids.map((id) => memberById.get(id)).filter(Boolean) as MemberLike[];
  return (
    <div className="gl-card" role="button" tabIndex={0} onClick={onOpen} data-achieved={achieved || undefined}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{ '--gc': color, animationDelay: `${Math.min(index, 8) * 40}ms` } as CSSProperties}>
      <div className="gl-card-top">
        <ProgressRing progress={g.progress} size={54} stroke={5} color={color} done={achieved}>
          {achieved ? <GoalIcon name="check" size={20} strokeWidth={2.8} /> : <b className="gl-card-pct">{g.progress}<small>%</small></b>}
        </ProgressRing>
        <div className="gl-card-chips">
          <StatusPill status={g.status} />
          {dueChip(g, today)}
        </div>
        <button type="button" className="gl-icon-btn gl-card-more" aria-label={`More for ${g.name}`}
          onClick={(e) => { e.stopPropagation(); menu.open(e); }}>
          <GoalIcon name="more" size={16} />
        </button>
      </div>
      <div className="gl-card-body">
        <span className="gl-card-project"><i />{project?.name}</span>
        <h3>{g.name}</h3>
        {g.description ? <p>{g.description}</p> : <p className="gl-muted">No description yet</p>}
      </div>
      <div className="gl-card-progress">
        <SegmentBar done={g.completed_count} total={g.task_count} color={color} />
        <span>{g.task_count ? <><b>{g.completed_count}</b>/{g.task_count} tasks</> : 'No tasks linked'}</span>
      </div>
      <div className="gl-card-foot">
        <PriorityBadge priority={g.priority} />
        {g.labels.slice(0, 2).map((l) => <span key={l} className="gl-label">{l}</span>)}
        {g.labels.length > 2 && <span className="gl-label">+{g.labels.length - 2}</span>}
        <span className="gl-grow" />
        <AvatarStack members={people} size={24} max={3} />
      </div>
      {achieved && <span className="gl-card-burst" aria-hidden="true" />}
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={210}>
          <div onClick={(e) => e.stopPropagation()}>
            <button type="button" className="gl-pop-item" onClick={() => { menu.close(); onOpen(); }}><GoalIcon name="target" size={14} />Open</button>
            <button type="button" className="gl-pop-item" onClick={() => { menu.close(); window.open(goalTabUrl(g.id), '_blank', 'noopener'); }}><GoalIcon name="external" size={14} />Open in new tab</button>
            <button type="button" className="gl-pop-item gl-danger" onClick={() => {
              menu.close();
              if (window.confirm(`Delete “${g.name}”? Linked tasks stay where they are.`)) void actions.deleteGoal(g.id).catch(() => undefined);
            }}><GoalIcon name="trash" size={14} />Delete goal</button>
          </div>
        </Popover>
      )}
    </div>
  );
}

function GoalRow({ goal: g, project, memberById, onOpen }: {
  goal: Goal;
  project?: GoalProject;
  memberById: Map<string, MemberLike>;
  onOpen: () => void;
}) {
  const today = todayKey();
  const color = project?.color || '#7c5cff';
  const people = g.assignee_ids.map((id) => memberById.get(id)).filter(Boolean) as MemberLike[];
  return (
    <button type="button" className="gl-row-item" onClick={onOpen} style={{ '--gc': color } as CSSProperties} data-achieved={g.status === 'achieved' || undefined}>
      <ProgressRing progress={g.progress} size={30} stroke={3.5} color={color} done={g.status === 'achieved'} />
      <span className="gl-row-name"><strong>{g.name}</strong><small><i />{project?.name}</small></span>
      <span className="gl-row-progress"><span className="gl-bar-mini"><span style={{ width: `${g.progress}%` }} /></span><b>{g.progress}%</b></span>
      <span className="gl-row-tasks">{g.completed_count}/{g.task_count}</span>
      <span className="gl-row-status"><StatusPill status={g.status} /></span>
      <span className="gl-row-prio"><PriorityBadge priority={g.priority} /></span>
      <span className="gl-row-due">{dueChip(g, today) || <em>{g.due_date ? formatDay(g.due_date) : '—'}</em>}</span>
      <span className="gl-row-people"><AvatarStack members={people} size={22} max={3} /></span>
    </button>
  );
}

function ProjectDialog({ project, count, onClose }: { project: GoalProject | null; count: number; onClose: () => void }) {
  const actions = useGoalActions();
  const startCreate = useGoalsUI((s) => s.startCreate);
  const [name, setName] = useState(project?.name || '');
  const [color, setColor] = useState(project?.color || PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (project) await actions.updateProject(project.id, { name: name.trim(), color });
      else {
        const p = await actions.createProject(name.trim(), color);
        onClose();
        startCreate({ projectId: p.id });
        return;
      }
      onClose();
    } catch { /* toasted */ } finally { setBusy(false); }
  };
  return (
    <GoalModal onClose={onClose} className="gl-project-dialog" labelledBy="gl-project-title">
      <form onSubmit={save} style={{ '--gc': color } as CSSProperties}>
        <header className="gl-create-head">
          <span className="gl-flag-tile"><GoalIcon name="folder" size={22} /></span>
          <div>
            <h2 id="gl-project-title">{project ? 'Edit project' : 'New project'}</h2>
            <p>Projects group related goals together.</p>
          </div>
          <button type="button" className="gl-icon-btn" onClick={onClose} aria-label="Close"><GoalIcon name="close" size={18} /></button>
        </header>
        <div className="gl-newproject">
          <div className="gl-newproject-row">
            <span className="gl-dot gl-dot-lg" style={{ background: color }} />
            <input autoFocus value={name} maxLength={160} placeholder="Project name" onChange={(e) => setName(e.target.value)} />
          </div>
          <ColorSwatches value={color} onChange={setColor} />
        </div>
        <footer className="gl-create-foot">
          {project && (confirm ? (
            <span className="gl-hint gl-danger-text">
              Delete it and its {count} goal{count === 1 ? '' : 's'}?
              <button type="button" className="gl-btn gl-btn-sm gl-btn-danger" onClick={() => { onClose(); void actions.deleteProject(project.id).catch(() => undefined); }}>Delete</button>
            </span>
          ) : (
            <button type="button" className="gl-text-btn gl-danger" onClick={() => setConfirm(true)}><GoalIcon name="trash" size={13} />Delete project</button>
          ))}
          <span className="gl-grow" />
          <button type="button" className="gl-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="gl-btn gl-btn-primary" disabled={busy || !name.trim()}>{project ? 'Save' : 'Create & add a goal'}</button>
        </footer>
      </form>
    </GoalModal>
  );
}

function EmptyHero({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="gl-hero-empty">
      <svg className="gl-hero-empty-art" viewBox="0 0 360 170" aria-hidden="true">
        <path d="M0 160 L92 70 L140 112 L206 34 L290 128 L330 96 L360 124 L360 170 L0 170Z" fill="var(--gl-mtn-back)" />
        <path d="M0 170 L70 118 L118 146 L196 82 L262 140 L320 120 L360 150 L360 170Z" fill="var(--gl-mtn-front)" />
        <path d="M206 34 L206 4" stroke="var(--sh-ink-3)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M207 5c8-4 15 3 24-1v14c-9 4-16-3-24 1z" fill="#ff6b4a">
          <animate attributeName="d" dur="2.4s" repeatCount="indefinite" values="M207 5c8-4 15 3 24-1v14c-9 4-16-3 -24 1z;M207 5c8 3 15-4 24 1v14c-9-4-16 3 -24-1z;M207 5c8-4 15 3 24-1v14c-9 4-16-3 -24 1z" />
        </path>
        <path d="M60 150 C120 140 150 120 200 40" fill="none" stroke="var(--sh-ink-4)" strokeWidth="1.6" strokeDasharray="3 6" strokeLinecap="round" />
      </svg>
      <h2>Every big win starts as a goal</h2>
      <p>Create a goal, link tasks from any list, and lay them out on a timeline. Progress fills in as the work gets done — and the goal is achieved when the last task is.</p>
      <div className="gl-hero-empty-steps">
        <span><b>1</b>Create a project &amp; goal</span>
        <span><b>2</b>Link tasks from anywhere</span>
        <span><b>3</b>Plan them on the timeline</span>
      </div>
      <button type="button" className="gl-btn gl-btn-primary gl-btn-lg" onClick={onCreate}><GoalIcon name="plus" size={16} />Create your first goal</button>
    </div>
  );
}
