import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { GoalInput, GoalProject } from '@squadhub/shared';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useWorkspaceMembers } from '../../../hooks/useWorkspaceMembers';
import { useAuthStore } from '../../../stores/authStore';
import GoalIcon, { WavingFlag } from './GoalIcons';
import { DateRangeField, LabelInput, MemberSelect, Popover, PrioritySelect, StatusSelect, useAnchor } from './GoalFields';
import { useGoalActions, useGoalsData } from './goalsApi';
import { useGoalsUI } from './goalsStore';
import { PROJECT_COLORS, errorMessage } from './goalUtils';
import { useGoalDialogFocus } from './useGoalDialogFocus';

/** Centered modal, portaled to body. Escape closes only the topmost one. */
export function GoalModal({ onClose, children, className = '', labelledBy }: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useGoalDialogFocus(panel);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.gl-pop, .dp-panel, .nt-menu')) return;
      const modals = document.querySelectorAll('.gl-modal');
      if (modals[modals.length - 1] !== panel.current?.parentElement) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return createPortal(
    <div className="gl-modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} tabIndex={-1} className={`gl-modal-panel ${className}`}>{children}</div>
    </div>,
    document.body,
  );
}

function ProjectPicker({ projects, value, onPick, onNew }: {
  projects: GoalProject[];
  value: string;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const a = useAnchor();
  const current = projects.find((p) => p.id === value);
  return (
    <>
      <button type="button" className="gl-project-btn" onClick={a.open} style={{ '--gc': current?.color } as React.CSSProperties}>
        <i />{current?.name || 'Choose project'}<GoalIcon name="chevronDown" size={13} />
      </button>
      {a.anchor && (
        <Popover anchor={a.anchor} onClose={a.close} width={250}>
          <div className="gl-pop-title">Project</div>
          <div className="gl-pop-scroll">
            {projects.map((p) => (
              <button key={p.id} type="button" className="gl-pop-item" data-active={p.id === value || undefined}
                onClick={() => { onPick(p.id); a.close(); }}>
                <span className="gl-dot" style={{ background: p.color }} />
                <span className="gl-pop-label">{p.name}</span>
                {p.id === value && <GoalIcon name="check" size={14} className="gl-pop-check" />}
              </button>
            ))}
          </div>
          <button type="button" className="gl-pop-item gl-pop-add" onClick={() => { a.close(); onNew(); }}>
            <GoalIcon name="plus" size={14} />New project
          </button>
        </Popover>
      )}
    </>
  );
}

export function ColorSwatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="gl-swatches" role="radiogroup" aria-label="Project color">
      {PROJECT_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={c === value} aria-label={c}
          className="gl-swatch" style={{ background: c }} data-active={c === value || undefined} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

export default function GoalCreateDialog() {
  const prefill = useGoalsUI((s) => s.create);
  const startCreate = useGoalsUI((s) => s.startCreate);
  const openGoal = useGoalsUI((s) => s.openGoal);
  const { data } = useGoalsData();
  const actions = useGoalActions();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const { data: members = [] } = useWorkspaceMembers(workspaceId);
  const me = useAuthStore((s) => s.user?.id);
  const lastProject = (() => { try { return localStorage.getItem('gl-last-project') || ''; } catch { return ''; } })();
  const initialProject = prefill?.projectId || data.projects.find((p) => p.id === lastProject)?.id || data.projects[0]?.id || '';

  const [form, setForm] = useState<GoalInput>({
    project_id: initialProject,
    name: '',
    description: '',
    status: 'planned',
    priority: 'normal',
    assignee_ids: me ? [me] : [],
    labels: [],
    work_start_date: null,
    work_end_date: null,
    start_date: null,
    due_date: null,
  });
  const [newProject, setNewProject] = useState<{ name: string; color: string } | null>(
    data.projects.length ? null : { name: '', color: PROJECT_COLORS[0] },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const labelSuggestions = useMemo(() => [...new Set(data.goals.flatMap((g) => g.labels))].sort(), [data.goals]);
  const set = <K extends keyof GoalInput>(k: K, v: GoalInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const close = () => startCreate(null);
  const color = newProject?.color || data.projects.find((p) => p.id === form.project_id)?.color || PROJECT_COLORS[0];

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setError('');
    if (!form.name.trim()) return setError('Give your goal a name');
    if (newProject && !newProject.name.trim()) return setError('Name the project this goal belongs to');
    if (!newProject && !form.project_id) return setError('Choose a project');
    setBusy(true);
    try {
      const projectId = newProject ? (await actions.createProject(newProject.name.trim(), newProject.color)).id : form.project_id;
      try { localStorage.setItem('gl-last-project', projectId); } catch { /* private mode */ }
      const goal = await actions.createGoal({ ...form, name: form.name.trim(), project_id: projectId, task_ids: prefill?.taskIds });
      close();
      openGoal(goal.id);
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t create the goal'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GoalModal onClose={close} className="gl-create" labelledBy="gl-create-title">
      <form onSubmit={submit} style={{ '--gc': color } as React.CSSProperties}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(); }}>
        <header className="gl-create-head">
          <span className="gl-flag-tile"><WavingFlag size={26} color={color} /></span>
          <div>
            <h2 id="gl-create-title">New goal</h2>
            {newProject ? (
              <p>Every goal lives in a project.</p>
            ) : (
              <p>in <ProjectPicker projects={data.projects} value={form.project_id}
                onPick={(id) => set('project_id', id)} onNew={() => setNewProject({ name: '', color: PROJECT_COLORS[data.projects.length % PROJECT_COLORS.length] })} /></p>
            )}
          </div>
          <button type="button" className="gl-icon-btn" onClick={close} aria-label="Close"><GoalIcon name="close" size={18} /></button>
        </header>

        {newProject && (
          <div className="gl-newproject">
            <div className="gl-newproject-row">
              <span className="gl-dot gl-dot-lg" style={{ background: newProject.color }} />
              <input autoFocus value={newProject.name} maxLength={160} placeholder="Project name — e.g. Website relaunch"
                onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} />
              {data.projects.length > 0 && (
                <button type="button" className="gl-text-btn" onClick={() => setNewProject(null)}>Use existing</button>
              )}
            </div>
            <ColorSwatches value={newProject.color} onChange={(c) => setNewProject({ ...newProject, color: c })} />
          </div>
        )}

        <div className="gl-create-main">
          <input className="gl-create-name" autoFocus={!newProject} value={form.name} maxLength={500}
            placeholder="What do you want to achieve?" onChange={(e) => set('name', e.target.value)} />
          <textarea className="gl-create-desc" value={form.description} rows={2}
            placeholder="Describe what success looks like…"
            onChange={(e) => {
              set('description', e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 220)}px`;
            }} />
        </div>

        <div className="gl-create-grid">
          <div className="gl-prop"><span>Status</span><StatusSelect value={form.status} onChange={(s) => set('status', s)} /></div>
          <div className="gl-prop"><span>Priority</span><PrioritySelect value={form.priority} title={form.name} onChange={(p) => set('priority', p)} /></div>
          <div className="gl-prop"><span>Assignees</span><MemberSelect members={members} value={form.assignee_ids} onChange={(ids) => set('assignee_ids', ids)} /></div>
          <div className="gl-prop"><span>Labels</span><LabelInput value={form.labels} suggestions={labelSuggestions} onChange={(l) => set('labels', l)} /></div>
          <div className="gl-prop gl-prop-wide"><span>Work dates</span>
            <DateRangeField kind="work" start={form.work_start_date} end={form.work_end_date} startLabel="Work start" endLabel="Work end"
              onChange={(s, e) => setForm((f) => ({ ...f, work_start_date: s, work_end_date: e }))} />
          </div>
          <div className="gl-prop gl-prop-wide"><span>Start &amp; due</span>
            <DateRangeField kind="plan" start={form.start_date} end={form.due_date} startLabel="Start" endLabel="Due"
              onChange={(s, e) => setForm((f) => ({ ...f, start_date: s, due_date: e }))} />
          </div>
        </div>

        {error && <p className="gl-error" role="alert">{error}</p>}

        <footer className="gl-create-foot">
          <span className="gl-hint">
            {prefill?.taskIds?.length
              ? <><GoalIcon name="link" size={13} />{prefill.taskIds.length === 1 ? 'This task' : `${prefill.taskIds.length} tasks`} will be linked</>
              : <><kbd>⌘</kbd><kbd>↵</kbd> to create</>}
          </span>
          <button type="button" className="gl-btn" onClick={close}>Cancel</button>
          <button type="submit" className="gl-btn gl-btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create goal'}
          </button>
        </footer>
      </form>
    </GoalModal>
  );
}
