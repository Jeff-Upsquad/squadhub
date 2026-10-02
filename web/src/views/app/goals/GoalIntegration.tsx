import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Goal } from '@squadhub/shared';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import GoalIcon, { ProgressRing, SegmentBar, WavingFlag } from './GoalIcons';
import { Popover } from './GoalFields';
import GoalDetail from './GoalDetail';
import GoalCreateDialog from './GoalCreateDialog';
import { PickGoalDialog, SourceDialog } from './GoalLinkDialog';
import { useGoalsData, useTaskGoals } from './goalsApi';
import { useGoalsUI } from './goalsStore';
import { STATUS_META, daysBetween, formatDay, isGoalInMotion, isGoalOverdue, todayKey } from './goalUtils';
import './goals.css';

const GOAL_PATH = /^\/app\/goals\/([0-9a-f-]{36})\/?$/i;

/**
 * Mounted once by MainLayout: the full-screen goal, create / pick / include
 * dialogs, and the standalone tab route (/app/goals/:id).
 */
export function GoalsHost() {
  const openGoalId = useGoalsUI((s) => s.openGoalId);
  const page = useGoalsUI((s) => s.page);
  const create = useGoalsUI((s) => s.create);
  const pickFor = useGoalsUI((s) => s.pickForTaskId);
  const connectSource = useGoalsUI((s) => s.connectSource);

  useEffect(() => {
    const match = window.location.pathname.match(GOAL_PATH);
    if (!match) return;
    const id = match[1];
    useGoalsUI.getState().openGoal(id, { page: true });
    // A new tab may hold a different workspace than the goal's — switch first.
    api.get(`/pm/goals/${id}/context`).then((r) => {
      const ws = r.data?.data;
      const current = useWorkspaceStore.getState().currentWorkspace;
      if (ws?.id && current?.id !== ws.id) useWorkspaceStore.getState().setWorkspace({ ...(current || {}), ...ws });
    }).catch(() => undefined);
  }, []);

  return (
    <>
      {openGoalId && <GoalDetail key={openGoalId} goalId={openGoalId} page={page} />}
      {create && <GoalCreateDialog />}
      {pickFor && <PickGoalDialog taskId={pickFor} onClose={() => useGoalsUI.getState().pickGoalFor(null)} />}
      {connectSource && (
        <SourceDialog goal={null} preselect={connectSource} onClose={() => useGoalsUI.getState().setConnectSource(null)} />
      )}
    </>
  );
}

/** Waving flag next to a task's focus star when the task serves a goal. */
export function GoalTaskFlag({ taskId, size = 15, className = '' }: { taskId: string; size?: number; className?: string }) {
  const goals = useTaskGoals(taskId);
  const { data } = useGoalsData();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  if (!goals.length) return null;
  // The goal view sits beneath the task panel, so step out of the task first.
  const openGoal = (id: string) => {
    const pm = usePMStore.getState();
    if (pm.activeTaskId) pm.setActiveTask(null);
    if (pm.peekTaskId) pm.setPeekTask(null);
    useGoalsUI.getState().openGoal(id);
  };
  const color = data.projects.find((p) => p.id === goals[0].project_id)?.color;
  const label = goals.length === 1 ? `Goal: ${goals[0].name}` : `Part of ${goals.length} goals`;
  return (
    <>
      <button
        type="button"
        className={`gl-task-flag ${className}`}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          if (goals.length === 1) openGoal(goals[0].id);
          else setAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <WavingFlag size={size} color={color || '#7c5cff'} />
        {goals.length > 1 && <span className="gl-task-flag-n">{goals.length}</span>}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={260}>
          <div className="gl-root" onClick={(e) => e.stopPropagation()}>
            <div className="gl-pop-title">Part of these goals</div>
            {goals.map((g) => {
              const p = data.projects.find((x) => x.id === g.project_id);
              return (
                <button key={g.id} type="button" className="gl-pop-item" onClick={() => { setAnchor(null); openGoal(g.id); }}>
                  <ProgressRing progress={g.progress} size={22} stroke={3} color={p?.color} />
                  <span className="gl-pop-label">{g.name}</span>
                  <small className="gl-pop-aside">{g.progress}%</small>
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Goals that have started (by date or status) and aren't done or paused. */
export function useGoalsInMotion(): Goal[] {
  const { data } = useGoalsData();
  return useMemo(() => {
    const today = todayKey();
    return data.goals.filter((g) => isGoalInMotion(g, today))
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  }, [data.goals]);
}

/** Home "disappearing card": shown only while a goal is in motion. */
export function HomeGoalsChip({ goals, onOpen }: { goals: Goal[]; onOpen: () => void }) {
  if (!goals.length) return null;
  const late = goals.some((g) => isGoalOverdue(g));
  return (
    <div className="hm-stat gl-hm-chip" data-alert={late} role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <div className="lbl">
        <WavingFlag size={13} color="#ff6b4a" />
        Goals
        {late && <span className="ping" />}
      </div>
      <div className="val">{goals.length}</div>
    </div>
  );
}

/** Slide-in list of goals in motion — same chrome as the other Home card panels. */
export function HomeGoalsPanel({ goals, open, onClose }: { goals: Goal[]; open: boolean; onClose: () => void }) {
  const { data } = useGoalsData();
  const openGoal = useGoalsUI((s) => s.openGoal);
  const showGoalsView = useGoalsUI((s) => s.showGoalsView);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!open) { setMounted(false); return undefined; }
    const id = requestAnimationFrame(() => setMounted(true));
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useGoalsUI.getState().openGoalId) onClose();
    };
    window.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(id); window.removeEventListener('keydown', key); };
  }, [open, onClose]);
  if (!open) return null;
  const today = todayKey();
  const tasks = goals.reduce((s, g) => s + g.task_count, 0);
  const done = goals.reduce((s, g) => s + g.completed_count, 0);
  return (
    <div className="fixed inset-0 z-[90]">
      <div className="hmp-backdrop" style={{ opacity: mounted ? 1 : 0 }} onClick={onClose} />
      <aside
        className="hmp gl-root gl-hmp"
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: mounted ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          transition: 'transform .42s cubic-bezier(0.23, 1, 0.32, 1), opacity .3s ease',
          opacity: mounted ? 1 : 0,
        }}
      >
        <div className="hmp-head">
          <button type="button" onClick={onClose} className="hmp-close" title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M13 17l5-5-5-5M6 17l5-5-5-5" /></svg>
          </button>
          <div className="hmp-head-text">
            <div className="hmp-eyebrow">Started &amp; in progress</div>
            <h3 className="hmp-title">Goals in motion</h3>
            <div className="hmp-summary">{goals.length} goal{goals.length === 1 ? '' : 's'} · {done}/{tasks} tasks done</div>
          </div>
          <div className="hmp-head-actions">
            <button type="button" className="gl-text-btn" onClick={() => { onClose(); showGoalsView(); }}>All goals<GoalIcon name="arrow" size={13} /></button>
          </div>
        </div>
        <div className="hmp-scroll sh-view gl-hmp-list">
          {goals.map((g, i) => {
            const p = data.projects.find((x) => x.id === g.project_id);
            const left = g.due_date ? daysBetween(today, g.due_date) : null;
            return (
              <button key={g.id} type="button" className="gl-hmp-goal" style={{ '--gc': p?.color, animationDelay: `${i * 35}ms` } as CSSProperties}
                onClick={() => { onClose(); openGoal(g.id); }}>
                <ProgressRing progress={g.progress} size={46} stroke={4.5} color={p?.color}>
                  <b className="gl-card-pct">{g.progress}<small>%</small></b>
                </ProgressRing>
                <span className="gl-hmp-text">
                  <small><i />{p?.name} · {STATUS_META[g.status].label}</small>
                  <strong>{g.name}</strong>
                  <span className="gl-hmp-meta">
                    <SegmentBar done={g.completed_count} total={g.task_count} color={p?.color} />
                    <em>{g.completed_count}/{g.task_count}</em>
                  </span>
                </span>
                {left != null && (
                  <span className="gl-due" data-tone={left < 0 ? 'late' : left <= 3 ? 'soon' : undefined}>
                    {left < 0 ? `${-left}d late` : left === 0 ? 'Today' : left <= 14 ? `${left}d left` : formatDay(g.due_date)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
