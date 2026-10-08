import { useEffect, useMemo, useState } from 'react';
import type { ListViewRow, SpaceStatus, Task, TaskBucket, TaskPriority } from '@squadhub/shared';
import { TASK_BUCKETS, taskBucketOf } from '@squadhub/shared';
import { useCreateTask, useTasks, useUpdateTask } from '../../../hooks/useTasks';
import { usePMStore } from '../../../stores/pmStore';
import { filterTasks, EMPTY_FILTER, type TaskFilterState } from '../../../lib/filters';
import { isTaskVisibleInView } from '../../../lib/viewKeywordMatching';
import { isTaskCompleted } from '../../../lib/taskGrouping';
import {
  PRIORITY_LANES,
  bucketOfTask,
  effectiveStageKey,
  findStatus,
  firstStageInBucket,
  isPlaceholderStatus,
  groupTasksByBucket,
  groupTasksByStage,
  isTaskOverdue,
  stageKeyOf,
  type BoardColumnsMode,
  type BoardLanesMode,
} from '../../../lib/stageWorkflow';
import { formatDated } from './taskHelpers';
import PriorityPicker, { PRIORITY_META } from './PriorityPicker';
import { OverdueBadge, PlanChip, RoutineBadge } from './StageChips';

// Board for lists whose status group is a STAGE workflow. Columns are the
// list's own stages (or the 4 universal buckets); inside every column cards
// are ordered priority → overdue → due date. Optional priority swimlanes put
// every Emergency in one row across all stages. Dropping a card can change
// its stage AND (in a lane) its priority in one move.

type Column = { key: string; label: string; color: string; bucket: TaskBucket; tasks: Task[] };

const PREFS_KEY = (listId: string) => `sh-stage-board:${listId}`;

function loadPrefs(listId: string): { columns: BoardColumnsMode; lanes: BoardLanesMode } {
  try {
    const raw = localStorage.getItem(PREFS_KEY(listId));
    if (raw) {
      const p = JSON.parse(raw);
      return {
        columns: p.columns === 'bucket' ? 'bucket' : 'stage',
        lanes: p.lanes === 'priority' ? 'priority' : 'none',
      };
    }
  } catch { /* storage unavailable */ }
  return { columns: 'stage', lanes: 'none' };
}

type CardPatch = { priority?: TaskPriority; work_date?: string | null; status?: string };

function StageCard({
  task,
  stageLabel,
  stageColor,
  placeholder,
  resumeTo,
  canEdit,
  tz,
  onPatch,
}: {
  task: Task;
  stageLabel?: string;
  stageColor?: string;
  /** Placeholder ("current status") the task is parked in, shown faintly. */
  placeholder?: SpaceStatus | null;
  /** Stage the task returns to when the placeholder is cleared. */
  resumeTo?: SpaceStatus | null;
  canEdit: boolean;
  tz: string;
  onPatch: (patch: CardPatch) => void;
}) {
  const { setActiveTask } = usePMStore();
  const [priRect, setPriRect] = useState<DOMRect | null>(null);
  const pri = (task.priority || 'none') as TaskPriority;
  const pm = PRIORITY_META[pri];
  // Finished work has no plan and can't be overdue — keep the card quiet.
  const done = isTaskCompleted(task);
  const overdue = isTaskOverdue(task);
  const due = !done && task.due_date ? formatDated(task.due_date, 'Due')?.text : null;
  const subtasks = task.subtasks || [];

  return (
    <div onClick={() => setActiveTask(task.id)} className="bv-card sw-card" data-pri={pri}>
      <div className="sw-card-top">
        <button
          type="button"
          className="sw-pri"
          data-none={pri === 'none' || undefined}
          style={pri === 'none' ? undefined : { color: pm.color, background: `${pm.color}14`, borderColor: `${pm.color}40` }}
          title={canEdit ? 'Change priority' : 'Priority'}
          onClick={(e) => {
            e.stopPropagation();
            if (canEdit) setPriRect((e.currentTarget as HTMLElement).getBoundingClientRect());
          }}
        >
          <span className="nt-pri-dot" style={{ background: pri === 'none' ? 'transparent' : pm.color, borderColor: pri === 'none' ? 'var(--sh-hair-2)' : pm.color }} />
          {pri === 'none' ? 'Priority' : pm.label}
        </button>
        {stageLabel && (
          <span className="sw-chip sw-stage" style={{ color: stageColor, borderColor: `${stageColor}55` }}>{stageLabel}</span>
        )}
        {subtasks.length > 0 && (
          <span className="sw-sub">
            {subtasks.filter((s: any) => (s.status || '').toLowerCase() === 'closed').length}/{subtasks.length}
          </span>
        )}
      </div>

      {placeholder && (
        <div className="sw-parked" title={`Current status: ${placeholder.name}${resumeTo ? ` · returns to ${resumeTo.name}` : ''}`}>
          <span className="sw-parked-dot" style={{ background: placeholder.color }} />
          <span className="sw-parked-label">{placeholder.name}</span>
          {canEdit && resumeTo && (
            <button
              type="button"
              className="sw-parked-resume"
              onClick={(e) => { e.stopPropagation(); onPatch({ status: resumeTo.id }); }}
              title={`Clear and go back to ${resumeTo.name}`}
            >
              ↩ {resumeTo.name}
            </button>
          )}
        </div>
      )}

      <p className="bv-card-title" style={{ margin: '8px 0 10px' }}>{task.title}</p>

      <div className="sw-card-meta">
        {!done && (
          <PlanChip
            workDate={task.work_date}
            tz={tz}
            canEdit={canEdit}
            onChange={(work_date) => onPatch({ work_date })}
          />
        )}
        {overdue && <OverdueBadge />}
        {!overdue && due && <span className="sw-due">{due}</span>}
        {task.recurring_parent_id && <RoutineBadge />}
        {task.assignees && task.assignees.length > 0 && (
          <div className="sw-avatars">
            {task.assignees.slice(0, 3).map((u: any) => (
              <span key={u.id} className="sw-avatar" title={u.display_name || u.email}>
                {(u.display_name || u.email)?.[0]?.toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </div>

      {priRect && (
        // React events bubble out of portals to the card — don't open the task.
        <span onClick={(e) => e.stopPropagation()}>
          <PriorityPicker
            anchorRect={priRect}
            value={pri}
            taskTitle={task.title}
            onChange={(p) => onPatch({ priority: p })}
            onClose={() => setPriRect(null)}
          />
        </span>
      )}
    </div>
  );
}

function StageColumn({
  column,
  tasks,
  showStageOnCards,
  statuses,
  canEdit,
  tz,
  laneKey,
  compact,
  onDropTask,
  onPatch,
  onQuickAdd,
}: {
  column: Column;
  tasks: Task[];
  showStageOnCards: boolean;
  statuses: SpaceStatus[];
  canEdit: boolean;
  tz: string;
  laneKey?: string;
  compact?: boolean;
  onDropTask: (taskId: string, columnKey: string, laneKey?: string) => void;
  onPatch: (taskId: string, patch: CardPatch) => void;
  onQuickAdd: (title: string, columnKey: string, laneKey?: string) => void;
}) {
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');

  const submit = () => {
    if (title.trim()) onQuickAdd(title.trim(), column.key, laneKey);
    setTitle('');
    setAdding(false);
  };

  return (
    <div
      className="bv-column sw-column"
      data-compact={compact || undefined}
      data-dragover={over}
      onDragOver={(e) => { if (!canEdit) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/plain');
        if (id) onDropTask(id, column.key, laneKey);
      }}
    >
      {!compact && (
        <div className="bv-column-head">
          <span className="dot" style={{ backgroundColor: column.color, color: column.color }} />
          <span className="title">{column.label}</span>
          <span className="count">· {tasks.length}</span>
          {column.key !== column.bucket && (
            <span className="sw-bucket-tag" title="Bucket this stage belongs to">
              {TASK_BUCKETS.find((b) => b.key === column.bucket)?.label}
            </span>
          )}
        </div>
      )}
      <div className="bv-cards">
        {tasks.map((t) => {
          const raw = stageKeyOf(t);
          const placeholder = isPlaceholderStatus(statuses, raw) ? findStatus(statuses, raw) : null;
          const stage = findStatus(statuses, effectiveStageKey(t, statuses));
          const st = showStageOnCards ? stage : null;
          return (
            <div key={t.id} draggable={canEdit} onDragStart={canEdit ? (e) => e.dataTransfer.setData('text/plain', t.id) : undefined}>
              <StageCard
                task={t}
                stageLabel={st?.name}
                stageColor={st?.color}
                placeholder={placeholder}
                resumeTo={placeholder ? stage : null}
                canEdit={canEdit}
                tz={tz}
                onPatch={(p) => onPatch(t.id, p)}
              />
            </div>
          );
        })}
        {canEdit && (adding ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') { setAdding(false); setTitle(''); }
            }}
            onBlur={submit}
            placeholder="Task name..."
            className="w-full rounded-lg border border-[color:var(--sh-hair)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--sh-ink)] outline-none focus:border-[color:var(--sh-accent)]"
          />
        ) : (
          <button className="bv-add-btn" onClick={() => setAdding(true)}>+ Add task</button>
        ))}
      </div>
    </div>
  );
}

export default function StageBoardView({
  listId,
  statuses,
  filters,
  searchQuery = '',
  canEdit = true,
  activeView,
  allViews,
}: {
  listId: string;
  statuses: SpaceStatus[];
  filters?: TaskFilterState;
  searchQuery?: string;
  canEdit?: boolean;
  activeView?: ListViewRow | null;
  allViews?: ListViewRow[];
}) {
  const { data: tasks, isLoading } = useTasks(listId, undefined);
  const updateTask = useUpdateTask(listId);
  const createTask = useCreateTask(listId);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const [prefs, setPrefs] = useState(() => loadPrefs(listId));
  useEffect(() => { setPrefs(loadPrefs(listId)); }, [listId]);
  const savePrefs = (next: typeof prefs) => {
    setPrefs(next);
    try { localStorage.setItem(PREFS_KEY(listId), JSON.stringify(next)); } catch { /* ignore */ }
  };

  const visible = useMemo(() => {
    let arr = filterTasks(tasks ?? [], filters ?? EMPTY_FILTER, tz);
    if (activeView) arr = arr.filter((t) => isTaskVisibleInView(t, activeView, allViews));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      arr = arr.filter((t) => t.title.toLowerCase().includes(q));
    }
    return arr;
  }, [tasks, filters, tz, activeView, allViews, searchQuery]);

  const columns: Column[] = useMemo(() => {
    if (prefs.columns === 'bucket') {
      return groupTasksByBucket(visible, statuses, fadingTaskIds).map((g) => ({
        key: g.key,
        label: g.label,
        color: g.color,
        bucket: g.key as TaskBucket,
        tasks: g.tasks,
      }));
    }
    return groupTasksByStage(visible, statuses, fadingTaskIds).map(({ status, tasks: ts }) => ({
      key: status.id,
      label: status.name,
      color: status.color,
      bucket: taskBucketOf(status),
      tasks: ts,
    }));
  }, [prefs.columns, visible, statuses, fadingTaskIds]);

  const stageForColumn = (columnKey: string): string | null => {
    if (prefs.columns === 'bucket') return firstStageInBucket(statuses, columnKey as TaskBucket)?.id ?? null;
    return columnKey;
  };

  const handleDrop = (taskId: string, columnKey: string, laneKey?: string) => {
    if (!canEdit) return;
    const task = (tasks ?? []).find((t) => t.id === taskId);
    if (!task) return;
    const patch: { id: string; status?: string; priority?: string } = { id: taskId };
    if (prefs.columns === 'bucket') {
      // Already in this bucket → keep its exact stage.
      if (bucketOfTask(task, statuses) !== columnKey) {
        const st = stageForColumn(columnKey);
        if (st) patch.status = st;
      }
    } else if (effectiveStageKey(task, statuses).toLowerCase() !== columnKey.toLowerCase()) {
      // Moving to another stage also clears any placeholder it was parked in.
      patch.status = columnKey;
    }
    if (laneKey && (task.priority || 'none') !== laneKey) patch.priority = laneKey;
    if (patch.status || patch.priority) updateTask.mutate(patch);
  };

  const handlePatch = (taskId: string, p: CardPatch) => {
    updateTask.mutate({ id: taskId, ...p });
  };

  const handleQuickAdd = (title: string, columnKey: string, laneKey?: string) => {
    const status = stageForColumn(columnKey) || undefined;
    createTask.mutate({
      title,
      status,
      priority: laneKey && laneKey !== 'none' ? (laneKey as TaskPriority) : undefined,
    } as any);
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[color:var(--sh-ink-3)]">Loading tasks...</p>
      </div>
    );
  }

  const showStageOnCards = prefs.columns === 'bucket';

  return (
    <div className="lv-canvas relative flex flex-1 flex-col overflow-hidden">
      <div className="sw-toolbar">
        <div className="sw-seg" role="group" aria-label="Board columns">
          <span className="sw-seg-label">Columns</span>
          <button data-on={prefs.columns === 'stage' || undefined} onClick={() => savePrefs({ ...prefs, columns: 'stage' })}>Stages</button>
          <button data-on={prefs.columns === 'bucket' || undefined} onClick={() => savePrefs({ ...prefs, columns: 'bucket' })}>Buckets</button>
        </div>
        <div className="sw-seg" role="group" aria-label="Board lanes">
          <span className="sw-seg-label">Lanes</span>
          <button data-on={prefs.lanes === 'none' || undefined} onClick={() => savePrefs({ ...prefs, lanes: 'none' })}>Off</button>
          <button data-on={prefs.lanes === 'priority' || undefined} onClick={() => savePrefs({ ...prefs, lanes: 'priority' })}>Priority</button>
        </div>
        <span className="sw-hint">Cards sort by priority → overdue → due date</span>
      </div>

      {prefs.lanes === 'none' ? (
        <div className="bv-board">
          {columns.map((c) => (
            <StageColumn
              key={c.key}
              column={c}
              tasks={c.tasks}
              showStageOnCards={showStageOnCards}
              statuses={statuses}
              canEdit={canEdit}
              tz={tz}
              onDropTask={handleDrop}
              onPatch={handlePatch}
              onQuickAdd={handleQuickAdd}
            />
          ))}
        </div>
      ) : (
        <div className="sw-lanes">
          <div className="sw-lane-heads">
            <div className="sw-lane-gutter" />
            {columns.map((c) => (
              <div key={c.key} className="sw-lane-colhead">
                <span className="dot" style={{ backgroundColor: c.color }} />
                <span className="title">{c.label}</span>
                <span className="count">· {c.tasks.length}</span>
              </div>
            ))}
          </div>
          {PRIORITY_LANES.map((lane) => {
            const laneCount = columns.reduce((n, c) => n + c.tasks.filter((t) => (t.priority || 'none') === lane.key).length, 0);
            return (
              <div key={lane.key} className="sw-lane" data-empty={laneCount === 0 || undefined}>
                <div className="sw-lane-gutter">
                  <span className="sw-lane-bar" style={{ background: lane.color }} />
                  <span className="sw-lane-label">{lane.label}</span>
                  <span className="sw-lane-count">{laneCount}</span>
                </div>
                {columns.map((c) => (
                  <StageColumn
                    key={c.key}
                    column={c}
                    tasks={c.tasks.filter((t) => (t.priority || 'none') === lane.key)}
                    showStageOnCards={showStageOnCards}
                    statuses={statuses}
                    canEdit={canEdit}
                    tz={tz}
                    laneKey={lane.key}
                    compact
                    onDropTask={handleDrop}
                    onPatch={handlePatch}
                    onQuickAdd={handleQuickAdd}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
