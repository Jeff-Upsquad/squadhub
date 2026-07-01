'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  Handle,
  Position,
  ConnectionMode,
  SelectionMode,
  MarkerType,
  NodeResizer,
  NodeToolbar,
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  getBezierPath,
  getSmoothStepPath,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useViewport,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
} from '@xyflow/react';
import type { SpaceStatus, WhiteboardData, WhiteboardNode, WhiteboardEdge, WhiteboardNodeData, WhiteboardNodeType, WhiteboardShape, WhiteboardLineType, Task } from '@squadhub/shared';
import { getTaskStatusCategory } from '@squadhub/shared';
import { useWhiteboard, useWhiteboardAutosave } from '../../../hooks/useWhiteboard';
import { useCreateTask, useUpdateTask, useTasks } from '../../../hooks/useTasks';
import { useWorkspaceSearch } from '../../../hooks/useWorkspaceSearch';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { usePMStore } from '../../../stores/pmStore';

type WBNode = Node<WhiteboardNodeData>;
type WBEdge = Edge;

// Sticky note palette (text stays dark on all of these).
const STICKY_COLORS = ['#FFE082', '#FFAB91', '#A5D6A7', '#90CAF9', '#CE93D8', '#F48FB1'];
// Fuller fill palette for the colour popover (two rows: vivid + pastel).
const FILL_COLORS = [
  '#1f2937', '#6b7280', '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  '#ffffff', '#d1d5db', '#fecaca', '#fed7aa', '#fde68a', '#bbf7d0', '#99f6e4', '#bfdbfe', '#ddd6fe', '#fbcfe8',
];
const NO_FILL = 'transparent';
const FONT_PX: Record<NonNullable<WhiteboardNodeData['fontSize']>, number> = { sm: 12, md: 15, lg: 21 };

// Darken a hex colour toward black by `factor` (0–1) — used to give a shape a
// border that's the same hue as its fill, just a shade deeper (FigJam-style).
// Returns null for anything that isn't a #rgb/#rrggbb hex (e.g. CSS vars).
function darkenHex(color: string | undefined, factor = 0.72): string | null {
  if (typeof color !== 'string' || color[0] !== '#') return null;
  const m = color.slice(1);
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (full.length !== 6) return null;
  const ch = (i: number) => {
    const v = parseInt(full.slice(i, i + 2), 16);
    if (Number.isNaN(v)) return null;
    return Math.max(0, Math.min(255, Math.round(v * factor)));
  };
  const r = ch(0), g = ch(2), b = ch(4);
  if (r === null || g === null || b === null) return null;
  const hx = (v: number) => v.toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// Initial sizes for resizable node types (text auto-sizes to its content).
const DEFAULT_SIZE: Partial<Record<WhiteboardNodeType, { width: number; height: number }>> = {
  sticky: { width: 188, height: 152 },
  shape: { width: 176, height: 120 },
  task: { width: 248, height: 116 },
};

const OPPOSITE: Record<string, string> = { t: 'b', b: 't', l: 'r', r: 'l' };
const HANDLE_ID: Record<string, string> = {
  [Position.Top]: 't', [Position.Right]: 'r', [Position.Bottom]: 'b', [Position.Left]: 'l',
};

// Available shapes for the shape picker. Each is drawn as an SVG inside the
// node's bounding box (viewBox 0 0 100 100, preserveAspectRatio="none"), so it
// stretches to whatever size the element is resized to.
const SHAPES: { key: WhiteboardShape; label: string }[] = [
  { key: 'rect', label: 'Rectangle' },
  { key: 'roundRect', label: 'Rounded rectangle' },
  { key: 'ellipse', label: 'Ellipse' },
  { key: 'diamond', label: 'Diamond' },
  { key: 'triangle', label: 'Triangle' },
  { key: 'triangleDown', label: 'Triangle down' },
  { key: 'parallelogram', label: 'Parallelogram' },
  { key: 'pentagon', label: 'Pentagon' },
  { key: 'hexagon', label: 'Hexagon' },
  { key: 'chevron', label: 'Chevron arrow' },
  { key: 'cylinder', label: 'Cylinder' },
];

// The SVG geometry for a shape. `fill`/`stroke` go through `style` so CSS
// variables resolve; the non-scaling stroke keeps a uniform outline regardless
// of the (non-uniform) scaling.
function ShapeGeom({ shape, fill = 'none', stroke = 'currentColor' }: { shape?: string; fill?: string; stroke?: string }) {
  const s: React.CSSProperties = { fill, stroke, strokeWidth: 1.6, vectorEffect: 'non-scaling-stroke', strokeLinejoin: 'round' };
  switch (shape) {
    case 'ellipse': return <ellipse cx="50" cy="50" rx="48" ry="48" style={s} />;
    case 'roundRect': return <rect x="2" y="2" width="96" height="96" rx="14" style={s} />;
    case 'diamond': return <polygon points="50,2 98,50 50,98 2,50" style={s} />;
    case 'triangle': return <polygon points="50,3 97,97 3,97" style={s} />;
    case 'triangleDown': return <polygon points="3,3 97,3 50,97" style={s} />;
    case 'parallelogram': return <polygon points="24,3 97,3 76,97 3,97" style={s} />;
    case 'pentagon': return <polygon points="50,2 98,40 80,97 20,97 2,40" style={s} />;
    case 'hexagon': return <polygon points="28,3 72,3 97,50 72,97 28,97 3,50" style={s} />;
    case 'chevron': return <polygon points="3,3 72,3 97,50 72,97 3,97 28,50" style={s} />;
    case 'cylinder': return <path d="M2,14 a48,12 0 0 1 96,0 v72 a48,12 0 0 1 -96,0 z M2,14 a48,12 0 0 0 96,0" style={s} />;
    case 'rect':
    default: return <rect x="2" y="2" width="96" height="96" style={s} />;
  }
}

// FigJam-style shape picker — search box + grid. Used by the toolbar (add a
// shape) and the edit bar (change a selected shape's type).
function ShapePicker({ current, onPick }: { current?: string; onPick: (key: WhiteboardShape) => void }) {
  const [q, setQ] = useState('');
  const list = SHAPES.filter((s) => s.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="wb-shape-pop nodrag nowheel">
      <input className="wb-shape-search" placeholder="Search for a shape" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="wb-shape-grid">
        {list.map((s) => (
          <button key={s.key} type="button" className="wb-shape-cell" data-active={current === s.key} title={s.label} onClick={() => onPick(s.key)}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none"><ShapeGeom shape={s.key} /></svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// A task the picker can attach to an element. Carried from either the current
// list (full Task) or a workspace-wide search hit (SearchTask). `subtitle` is
// the source-location breadcrumb (space · folder · list), shown on the card for
// tasks that live in another list.
type MentionTask = { id: string; title: string; display_number: number | null; done: boolean; subtitle?: string | null };

// Local node-kind union: the persisted WhiteboardNodeType plus the synthetic
// 'task' card used for mentions (kept here so this compiles regardless of how
// the shared package resolves during dev).
type WBKind = WhiteboardNodeType | 'task';

// A task counts as "done" when its status sits in the done/closed category.
// Accepts a joined status object, a status-key string, or the literal
// 'done'/'todo' the whiteboard checkbox itself writes.
function statusIsDone(status: unknown): boolean {
  if (status && typeof status === 'object') {
    const cat = (status as { category?: string }).category;
    return cat === 'done' || cat === 'closed';
  }
  if (typeof status === 'string' && status) {
    if (status === 'done' || status === 'closed') return true;
    const cat = getTaskStatusCategory(status);
    return cat === 'done' || cat === 'closed';
  }
  return false;
}

interface WhiteboardCtx {
  canEdit: boolean;
  listId: string;
  // How many nodes are currently selected. When >1 the per-node edit bars and
  // resizers hide and a single group toolbar takes over (see GroupEditBar).
  selectionCount: number;
  startConnectDrag: (sourceId: string, side: Position, e: React.PointerEvent) => void;
  editingId: string | null;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  updateNodeText: (id: string, text: string) => void;
  setNodeData: (id: string, patch: Partial<WhiteboardNodeData>) => void;
  convertToTask: (id: string) => void;
  mentionTask: (id: string, task: MentionTask) => void;
  unlinkTask: (id: string) => void;
  removeNode: (id: string) => void;
  openTask: (taskId: string) => void;
  toggleDone: (id: string) => void;
  duplicateNode: (nodeId: string, position: Position) => void;
  setEdgeLineType: (id: string, lineType: WhiteboardLineType) => void;
  cycleEdgeArrows: (id: string) => void;
  deleteEdge: (id: string) => void;
  setEdgeWaypoint: (id: string, waypoint: { x: number; y: number } | null) => void;
  editingEdgeId: string | null;
  startEditingEdge: (id: string) => void;
  setEdgeLabel: (id: string, label: string) => void;
}
const WBContext = createContext<WhiteboardCtx | null>(null);
const useWB = () => {
  const ctx = useContext(WBContext);
  if (!ctx) throw new Error('WhiteboardContext missing');
  return ctx;
};

// Tracks which edge of an element the cursor is nearest, so we can show a single
// duplicate arrow on that side (FigJam-style). A short hide delay + the arrow's
// own onMouseEnter let the cursor cross the small gap to the arrow without it
// vanishing.
function useNearestSide() {
  const [side, setSide] = useState<Position | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    cancelHide();
    const r = e.currentTarget.getBoundingClientRect();
    const dt = e.clientY - r.top, dr = r.right - e.clientX, db = r.bottom - e.clientY, dl = e.clientX - r.left;
    const m = Math.min(dt, dr, db, dl);
    setSide(m === dt ? Position.Top : m === dr ? Position.Right : m === db ? Position.Bottom : Position.Left);
  }, [cancelHide]);
  const onMouseLeave = useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => setSide(null), 160);
  }, [cancelHide]);
  return { side, onMouseMove, onMouseLeave, cancelHide };
}

// ── Inline text-formatting style derived from the element's data ────────────
function textStyle(data: WhiteboardNodeData): React.CSSProperties {
  return {
    color: data.textColor,
    fontWeight: data.bold ? 700 : undefined,
    fontSize: data.fontSize ? FONT_PX[data.fontSize] : undefined,
    textAlign: data.align,
  };
}

// ── Task chrome — ONLY rendered after an element is converted to a task ─────
// A checkbox (toggles the task's done state) plus a pill that opens the task.
function NodeChrome({ id, data }: { id: string; data: WhiteboardNodeData }) {
  const { canEdit, openTask, toggleDone } = useWB();
  if (!data.taskId) return null;
  return (
    <div className="wb-chrome nodrag">
      <input
        type="checkbox"
        className="wb-check"
        checked={!!data.done}
        disabled={!canEdit}
        title={data.done ? 'Mark not done' : 'Mark done'}
        onChange={() => canEdit && toggleDone(id)}
      />
      <button
        type="button"
        className="wb-task-pill nodrag"
        title="Open task"
        onClick={() => data.taskId && openTask(data.taskId)}
      >
        {data.taskNumber != null ? `#${data.taskNumber}` : 'Task'}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17L17 7M17 7H8M17 7v9" />
        </svg>
      </button>
    </div>
  );
}

// Editable text region. Editing is driven by the whiteboard's `editingId`
// (set by React Flow's onNodeDoubleClick — a native onDoubleClick here is
// unreliable because the drag layer preventDefaults mousedown, which suppresses
// the browser's dblclick event). Commits on blur.
function EditableText({ id, data, placeholder, className }: { id: string; data: WhiteboardNodeData; placeholder: string; className: string }) {
  const { canEdit, updateNodeText, editingId, startEditing, stopEditing } = useWB();
  const editing = editingId === id;
  const [draft, setDraft] = useState(data.text);
  const style = textStyle(data);

  useEffect(() => { if (!editing) setDraft(data.text); }, [data.text, editing]);

  if (editing) {
    return (
      <textarea
        autoFocus
        style={style}
        className={`${className} wb-text-edit nodrag nowheel`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { updateNodeText(id, draft); stopEditing(); }}
        onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }}
      />
    );
  }
  return (
    <div
      style={style}
      className={`${className} wb-text-view ${!data.text ? 'wb-text-empty' : ''} ${data.done ? 'wb-done' : ''}`}
      onDoubleClick={() => canEdit && startEditing(id)}
    >
      {data.text || placeholder}
    </div>
  );
}

// Four edge handles, kept invisible — they only serve as anchor points for the
// arrows that join an element to its duplicate (see CSS .wb-handle).
function NodeHandles() {
  // A source AND a target handle at each side (same id per side), so a
  // duplicate's edge can anchor its source end on one node's side and its
  // target end on the other's. CSS (.wb-handle) keeps them invisible and
  // pointer-events:none, so the user can't drag a connection from them.
  const side = (position: Position, id: string) => (
    <>
      <Handle id={id} type="source" position={position} className="wb-handle" />
      <Handle id={id} type="target" position={position} className="wb-handle" />
    </>
  );
  return (
    <>
      {side(Position.Top, 't')}
      {side(Position.Right, 'r')}
      {side(Position.Bottom, 'b')}
      {side(Position.Left, 'l')}
    </>
  );
}

// FigJam-style directional arrow — a SINGLE arrow on the side of the element
// nearest the cursor. It's a real connection handle: CLICK it to duplicate the
// element that way (handled in onConnectEnd), or DRAG it onto another element to
// connect them (onConnect). Its id is prefixed `arrow-` so onConnect can remap
// it to the persistent edge-anchor handle on that side.
const ARROW_CLS: Record<string, string> = {
  [Position.Top]: 'wb-arrow--t', [Position.Right]: 'wb-arrow--r',
  [Position.Bottom]: 'wb-arrow--b', [Position.Left]: 'wb-arrow--l',
};
function DuplicateArrows({ nodeId, side, onArrowEnter }: { nodeId: string; side: Position | null; onArrowEnter: () => void }) {
  const { canEdit, duplicateNode, startConnectDrag } = useWB();
  if (!canEdit || !side) return null;
  return (
    <button
      type="button"
      className={`wb-arrow ${ARROW_CLS[side]} nodrag nopan`}
      title="Drag to connect · click to duplicate"
      onMouseEnter={onArrowEnter}
      onPointerDown={(e) => startConnectDrag(nodeId, side, e)}
      onClick={(e) => { e.stopPropagation(); duplicateNode(nodeId, side); }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </button>
  );
}

// Dropdown for "Mention a task". Empty query → tasks in the current list;
// typing searches every list the caller can access (workspace-wide). Picking a
// row links the selected element to that existing task as a *mention*.
function TaskMentionPicker({ currentTaskId, onPick }: { currentTaskId?: string | null; onPick: (t: MentionTask) => void }) {
  const { listId } = useWB();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const [q, setQ] = useState('');
  const query = q.trim();
  const searching = query.length > 0;

  const { data: listTasks = [], isLoading: listLoading } = useTasks(listId);
  const { tasks: searchTasks, isLoading: searchLoading } = useWorkspaceSearch(workspaceId, query);

  const rows = useMemo(() => {
    if (searching) {
      return searchTasks
        .filter((t) => t.id !== currentTaskId)
        .map((t) => ({
          task: { id: t.id, title: t.title, display_number: t.display_number ?? null, done: statusIsDone(t.status) } as MentionTask,
          subtitle: [t.space_name, t.folder_name, t.list_name].filter(Boolean).join(' · ') || null,
        }));
    }
    return (listTasks as Task[])
      .filter((t) => t.id !== currentTaskId && !t.parent_task_id)
      .map((t) => ({
        task: { id: t.id, title: t.title, display_number: t.display_number ?? null, done: statusIsDone((t as { status?: unknown }).status) } as MentionTask,
        subtitle: null as string | null,
      }));
  }, [searching, searchTasks, listTasks, currentTaskId]);

  const loading = searching ? searchLoading : listLoading;

  return (
    <div className="wb-mention-pop nodrag nowheel">
      <input
        className="wb-mention-search"
        placeholder="Search tasks in any list…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className="wb-mention-list">
        {!searching && <div className="wb-mention-head">Tasks in this list</div>}
        {loading && rows.length === 0 && <div className="wb-mention-empty">Searching…</div>}
        {!loading && rows.length === 0 && (
          <div className="wb-mention-empty">{searching ? 'No matching tasks' : 'No tasks in this list yet'}</div>
        )}
        {rows.map(({ task, subtitle }) => (
          <button key={task.id} type="button" className="wb-mention-row" onClick={() => onPick({ ...task, subtitle })}>
            <span className="wb-mention-row-main">
              <span className={`wb-mention-title ${task.done ? 'wb-mention-done' : ''}`}>{task.title || 'Untitled task'}</span>
              {subtitle && <span className="wb-mention-sub">{subtitle}</span>}
            </span>
            {task.display_number != null && <span className="wb-mention-num">#{task.display_number}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// Floating edit bar shown above a selected element. Colour, text formatting,
// and the convert-to-task / mention-a-task actions all live here.
function EditBar({ id, data, type, visible }: { id: string; data: WhiteboardNodeData; type: WBKind; visible: boolean }) {
  const { setNodeData, convertToTask, mentionTask, unlinkTask, removeNode, openTask } = useWB();
  const [colorOpen, setColorOpen] = useState(false);
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [shapeOpen, setShapeOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const size = data.fontSize || 'md';
  const noFill = data.color === NO_FILL;
  const triggerColor = noFill ? 'transparent' : (data.color || (type === 'shape' ? 'var(--surface)' : STICKY_COLORS[0]));
  useEffect(() => { if (!visible) { setColorOpen(false); setTextColorOpen(false); setShapeOpen(false); setMentionOpen(false); } }, [visible]);
  // A mentioned-task card is a fixed reference, not a formatting target — its
  // bar only opens the task or removes the card.
  if (type === 'task') {
    return (
      <NodeToolbar isVisible={visible} position={Position.Top} offset={22} className="wb-ebar nodrag nowheel">
        <button type="button" className="wb-ebar-btn wb-ebar-text wb-ebar-mention" title="Open task" onClick={() => data.taskId && openTask(data.taskId)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H8M17 7v9" /></svg>
          Open task
        </button>
        <span className="wb-ebar-sep" />
        <button type="button" className="wb-ebar-btn wb-ebar-text" title="Remove this task card" onClick={() => removeNode(id)}>Remove</button>
      </NodeToolbar>
    );
  }
  return (
    <NodeToolbar isVisible={visible} position={Position.Top} offset={22} className="wb-ebar nodrag nowheel">
      {type !== 'text' && (
        <>
          <div className="wb-color-wrap">
            <button type="button" className="wb-ebar-btn wb-color-btn" title="Fill" onClick={() => setColorOpen((o) => !o)}>
              <span className="wb-ebar-swatch wb-color-trigger" data-nofill={noFill} style={{ background: triggerColor }} />
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {colorOpen && (
              <div className="wb-color-pop">
                <div className="wb-color-tabs">
                  <button type="button" data-active={!noFill} onClick={() => setNodeData(id, { color: data.color && !noFill ? data.color : FILL_COLORS[0] })}>Fill</button>
                  <button type="button" data-active={noFill} onClick={() => setNodeData(id, { color: NO_FILL })}>Transparent</button>
                  <button type="button" data-active={noFill} onClick={() => setNodeData(id, { color: NO_FILL })}>No fill</button>
                </div>
                <div className="wb-color-grid">
                  {FILL_COLORS.map((c) => (
                    <button key={c} type="button" className="wb-color-cell" data-active={data.color === c} style={{ background: c }} onClick={() => setNodeData(id, { color: c })} aria-label={c} />
                  ))}
                  <label className="wb-color-cell wb-color-custom" title="Custom colour">
                    <input type="color" value={typeof data.color === 'string' && data.color.startsWith('#') ? data.color : '#ffffff'} onChange={(e) => setNodeData(id, { color: e.target.value })} />
                  </label>
                </div>
              </div>
            )}
          </div>
          <span className="wb-ebar-sep" />
        </>
      )}
      {type === 'shape' && (
        <>
          <div className="wb-color-wrap">
            <button type="button" className="wb-ebar-btn" title="Shape" onClick={() => setShapeOpen((o) => !o)}>
              <svg width="14" height="14" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: 'block' }}><ShapeGeom shape={data.shape || 'rect'} stroke="currentColor" /></svg>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {shapeOpen && (
              <ShapePicker current={data.shape || 'rect'} onPick={(k) => { setNodeData(id, { shape: k }); setShapeOpen(false); }} />
            )}
          </div>
          <span className="wb-ebar-sep" />
        </>
      )}
      <button type="button" className="wb-ebar-btn" data-active={!!data.bold} title="Bold" onClick={() => setNodeData(id, { bold: !data.bold })}>
        <b>B</b>
      </button>
      {(['sm', 'md', 'lg'] as const).map((s) => (
        <button key={s} type="button" className="wb-ebar-btn wb-ebar-size" data-active={size === s} title={`${s === 'sm' ? 'Small' : s === 'md' ? 'Medium' : 'Large'} text`} onClick={() => setNodeData(id, { fontSize: s })}>
          {s === 'sm' ? 'S' : s === 'md' ? 'M' : 'L'}
        </button>
      ))}
      <span className="wb-ebar-sep" />
      <div className="wb-color-wrap">
        <button type="button" className="wb-ebar-btn wb-textcolor-btn" title="Text colour" onClick={() => setTextColorOpen((o) => !o)}>
          <span className="wb-textcolor-a">
            A
            <span className="wb-textcolor-bar" style={{ background: data.textColor || 'var(--sh-ink)' }} />
          </span>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {textColorOpen && (
          <div className="wb-color-pop">
            <div className="wb-color-tabs">
              <button type="button" data-active={!data.textColor} onClick={() => setNodeData(id, { textColor: undefined })}>Default</button>
            </div>
            <div className="wb-color-grid">
              {FILL_COLORS.map((c) => (
                <button key={c} type="button" className="wb-color-cell" data-active={data.textColor === c} style={{ background: c }} onClick={() => setNodeData(id, { textColor: c })} aria-label={c} />
              ))}
              <label className="wb-color-cell wb-color-custom" title="Custom colour">
                <input type="color" value={typeof data.textColor === 'string' && data.textColor.startsWith('#') ? data.textColor : '#000000'} onChange={(e) => setNodeData(id, { textColor: e.target.value })} />
              </label>
            </div>
          </div>
        )}
      </div>
      <span className="wb-ebar-sep" />
      <button type="button" className="wb-ebar-btn" data-active={(data.align || 'left') === 'left'} title="Align left" onClick={() => setNodeData(id, { align: 'left' })}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h13" /></svg>
      </button>
      <button type="button" className="wb-ebar-btn" data-active={data.align === 'center'} title="Align centre" onClick={() => setNodeData(id, { align: 'center' })}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M7 12h10M5 18h14" /></svg>
      </button>
      <span className="wb-ebar-sep" />
      {data.taskId ? (
        <>
          <button type="button" className="wb-ebar-btn wb-ebar-text" title="Open task" onClick={() => data.taskId && openTask(data.taskId)}>Open task</button>
          <button type="button" className="wb-ebar-btn wb-ebar-text" title="Unlink task" onClick={() => unlinkTask(id)}>Unlink</button>
        </>
      ) : (
        <>
          <button type="button" className="wb-ebar-btn wb-ebar-text wb-ebar-convert" title="Convert this element to a task" onClick={() => convertToTask(id)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            Convert to task
          </button>
          <div className="wb-color-wrap">
            <button type="button" className="wb-ebar-btn wb-ebar-text wb-ebar-mention" title="Mention an existing task" onClick={() => setMentionOpen((o) => !o)}>
              <span className="wb-ebar-at">@</span>
              Mention a task
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {mentionOpen && (
              <TaskMentionPicker
                currentTaskId={data.taskId}
                onPick={(t) => { mentionTask(id, t); setMentionOpen(false); }}
              />
            )}
          </div>
        </>
      )}
    </NodeToolbar>
  );
}

// Group edit bar — a single toolbar shown above a multi-selection (≥2 nodes).
// Its actions fan out to EVERY selected node at once (fill, text colour, bold,
// text size, alignment) plus duplicate/delete. Anchored to the bounding box of
// the selection via NodeToolbar's array `nodeId`. Per-node bars hide while this
// is up (see the `solo` gate in each node).
function GroupEditBar({ ids, nodes, onPatch, onDuplicate, onDelete }: {
  ids: string[];
  nodes: WBNode[];
  onPatch: (patch: Partial<WhiteboardNodeData>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [fillOpen, setFillOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const visible = ids.length >= 2;
  useEffect(() => { if (!visible) { setFillOpen(false); setTextOpen(false); } }, [visible]);
  // Highlight a formatting button only when the whole selection already shares it.
  const allBold = nodes.length > 0 && nodes.every((n) => !!n.data.bold);
  const first = nodes[0]?.data;
  const size = first && nodes.every((n) => (n.data.fontSize || 'md') === (first.fontSize || 'md')) ? (first.fontSize || 'md') : null;
  const align = first && nodes.every((n) => (n.data.align || 'left') === (first.align || 'left')) ? (first.align || 'left') : null;
  return (
    <NodeToolbar nodeId={ids} isVisible={visible} position={Position.Top} offset={22} className="wb-ebar nodrag nowheel">
      <span className="wb-ebar-count">{ids.length} selected</span>
      <span className="wb-ebar-sep" />
      {/* Fill colour → all selected */}
      <div className="wb-color-wrap">
        <button type="button" className="wb-ebar-btn wb-color-btn" title="Fill" onClick={() => { setFillOpen((o) => !o); setTextOpen(false); }}>
          <span className="wb-ebar-swatch" style={{ background: 'conic-gradient(#ef4444,#f59e0b,#22c55e,#3b82f6,#8b5cf6,#ef4444)' }} />
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {fillOpen && (
          <div className="wb-color-pop">
            <div className="wb-color-tabs">
              <button type="button" onClick={() => onPatch({ color: FILL_COLORS[0] })}>Fill</button>
              <button type="button" onClick={() => onPatch({ color: NO_FILL })}>No fill</button>
            </div>
            <div className="wb-color-grid">
              {FILL_COLORS.map((c) => (
                <button key={c} type="button" className="wb-color-cell" style={{ background: c }} onClick={() => onPatch({ color: c })} aria-label={c} />
              ))}
              <label className="wb-color-cell wb-color-custom" title="Custom colour">
                <input type="color" defaultValue="#ffffff" onChange={(e) => onPatch({ color: e.target.value })} />
              </label>
            </div>
          </div>
        )}
      </div>
      {/* Text colour → all selected */}
      <div className="wb-color-wrap">
        <button type="button" className="wb-ebar-btn wb-textcolor-btn" title="Text colour" onClick={() => { setTextOpen((o) => !o); setFillOpen(false); }}>
          <span className="wb-textcolor-a">A<span className="wb-textcolor-bar" style={{ background: 'var(--sh-ink)' }} /></span>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {textOpen && (
          <div className="wb-color-pop">
            <div className="wb-color-tabs">
              <button type="button" onClick={() => onPatch({ textColor: undefined })}>Default</button>
            </div>
            <div className="wb-color-grid">
              {FILL_COLORS.map((c) => (
                <button key={c} type="button" className="wb-color-cell" style={{ background: c }} onClick={() => onPatch({ textColor: c })} aria-label={c} />
              ))}
              <label className="wb-color-cell wb-color-custom" title="Custom colour">
                <input type="color" defaultValue="#000000" onChange={(e) => onPatch({ textColor: e.target.value })} />
              </label>
            </div>
          </div>
        )}
      </div>
      <span className="wb-ebar-sep" />
      <button type="button" className="wb-ebar-btn" data-active={allBold} title="Bold" onClick={() => onPatch({ bold: !allBold })}><b>B</b></button>
      {(['sm', 'md', 'lg'] as const).map((s) => (
        <button key={s} type="button" className="wb-ebar-btn wb-ebar-size" data-active={size === s} title={`${s === 'sm' ? 'Small' : s === 'md' ? 'Medium' : 'Large'} text`} onClick={() => onPatch({ fontSize: s })}>
          {s === 'sm' ? 'S' : s === 'md' ? 'M' : 'L'}
        </button>
      ))}
      <span className="wb-ebar-sep" />
      <button type="button" className="wb-ebar-btn" data-active={align === 'left'} title="Align left" onClick={() => onPatch({ align: 'left' })}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h13" /></svg>
      </button>
      <button type="button" className="wb-ebar-btn" data-active={align === 'center'} title="Align centre" onClick={() => onPatch({ align: 'center' })}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M7 12h10M5 18h14" /></svg>
      </button>
      <span className="wb-ebar-sep" />
      <button type="button" className="wb-ebar-btn wb-ebar-text" title="Duplicate selection" onClick={onDuplicate}>Duplicate</button>
      <button type="button" className="wb-ebar-btn wb-ebar-text" title="Delete selection" onClick={onDelete}>Delete</button>
    </NodeToolbar>
  );
}

// Group resize — a bounding box with 8 handles drawn around a multi-selection
// (≥2 nodes). Dragging a handle scales every selected node's position and size
// proportionally around the opposite edge/corner (FigJam-style). Rendered as a
// fixed overlay in SCREEN space (so handle size stays constant at any zoom); the
// box tracks pan/zoom via useViewport and follows nodes as they scale.
type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const GRESIZE_HANDLES: Array<[ResizeDir, number, number]> = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5],
  ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5],
];
function GroupResizer({ nodes, setNodes }: { nodes: WBNode[]; setNodes: React.Dispatch<React.SetStateAction<WBNode[]>> }) {
  const rf = useReactFlow();
  useViewport(); // re-render as the canvas pans / zooms so the box stays aligned
  if (nodes.length < 2) return null;

  const dims = (n: WBNode) => ({
    w: n.width ?? n.measured?.width ?? 0,
    h: n.height ?? n.measured?.height ?? 0,
  });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const { w, h } = dims(n);
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w); maxY = Math.max(maxY, n.position.y + h);
  }
  if (!isFinite(minX)) return null;
  const tl = rf.flowToScreenPosition({ x: minX, y: minY });
  const br = rf.flowToScreenPosition({ x: maxX, y: maxY });

  const onDown = (dir: ResizeDir) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const b = { minX, minY, maxX, maxY };
    const spanX = Math.max(b.maxX - b.minX, 1e-6);
    const spanY = Math.max(b.maxY - b.minY, 1e-6);
    const dirX = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0;
    const dirY = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0;
    const anchorX = dirX === -1 ? b.maxX : b.minX; // the edge that stays put
    const anchorY = dirY === -1 ? b.maxY : b.minY;
    // Snapshot each node's start geometry; only nodes with an EXPLICIT size get
    // resized (text nodes autosize to content — we just reposition them).
    const snap = nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, ...dims(n), sizeW: n.width != null, sizeH: n.height != null }));
    const move = (ev: PointerEvent) => {
      const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      let sx = 1, sy = 1;
      if (dirX === 1) sx = (p.x - b.minX) / spanX; else if (dirX === -1) sx = (b.maxX - p.x) / spanX;
      if (dirY === 1) sy = (p.y - b.minY) / spanY; else if (dirY === -1) sy = (b.maxY - p.y) / spanY;
      sx = Math.max(sx, 0.1); sy = Math.max(sy, 0.1);
      const byId = new Map(snap.map((s) => [s.id, s]));
      setNodes((nds) => nds.map((n) => {
        const s = byId.get(n.id);
        if (!s) return n;
        const next: WBNode = { ...n, position: { x: anchorX + (s.x - anchorX) * sx, y: anchorY + (s.y - anchorY) * sy } };
        if (s.sizeW) next.width = Math.max(20, s.w * sx);
        if (s.sizeH) next.height = Math.max(20, s.h * sy);
        return next;
      }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const cursorFor: Record<ResizeDir, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  return (
    <div className="wb-gresize" style={{ position: 'fixed', left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y, pointerEvents: 'none', zIndex: 50 }}>
      {GRESIZE_HANDLES.map(([dir, fx, fy]) => (
        <div
          key={dir}
          className="wb-gresize-h"
          style={{ position: 'absolute', left: `${fx * 100}%`, top: `${fy * 100}%`, cursor: cursorFor[dir] }}
          onPointerDown={onDown(dir)}
        />
      ))}
    </div>
  );
}

function StickyNode({ id, data, selected }: NodeProps<WBNode>) {
  const { canEdit, selectionCount } = useWB();
  const solo = selectionCount < 2;
  const { side, onMouseMove, onMouseLeave, cancelHide } = useNearestSide();
  return (
    <div className="wb-sticky" style={{ background: data.color || STICKY_COLORS[0] }} onMouseMove={canEdit ? onMouseMove : undefined} onMouseLeave={onMouseLeave}>
      <NodeResizer minWidth={120} minHeight={96} isVisible={!!selected && canEdit && solo} color="var(--sh-ink-3)" />
      <NodeHandles />
      <EditBar id={id} data={data} type="sticky" visible={!!selected && canEdit && solo} />
      {!selected && <DuplicateArrows nodeId={id} side={side} onArrowEnter={cancelHide} />}
      <NodeChrome id={id} data={data} />
      <EditableText id={id} data={data} placeholder="Type a note…" className="wb-sticky-text" />
    </div>
  );
}

function TextNode({ id, data, selected }: NodeProps<WBNode>) {
  const { canEdit, selectionCount } = useWB();
  const solo = selectionCount < 2;
  const { side, onMouseMove, onMouseLeave, cancelHide } = useNearestSide();
  return (
    <div className="wb-textnode" onMouseMove={canEdit ? onMouseMove : undefined} onMouseLeave={onMouseLeave}>
      <NodeHandles />
      <EditBar id={id} data={data} type="text" visible={!!selected && canEdit && solo} />
      {!selected && <DuplicateArrows nodeId={id} side={side} onArrowEnter={cancelHide} />}
      <NodeChrome id={id} data={data} />
      <EditableText id={id} data={data} placeholder="Text" className="wb-textnode-text" />
    </div>
  );
}

function ShapeNode({ id, data, selected }: NodeProps<WBNode>) {
  const { canEdit, selectionCount } = useWB();
  const solo = selectionCount < 2;
  const { side, onMouseMove, onMouseLeave, cancelHide } = useNearestSide();
  const fill = data.color === NO_FILL ? 'none' : (data.color || 'var(--surface)');
  // Border matches the fill: a shade darker than the same hue. Falls back to the
  // neutral ink when there's no solid hex fill (no-fill / default surface).
  const stroke = darkenHex(data.color) ?? 'var(--sh-ink-3)';
  return (
    <div className="wb-shape" onMouseMove={canEdit ? onMouseMove : undefined} onMouseLeave={onMouseLeave}>
      <NodeResizer minWidth={80} minHeight={60} isVisible={!!selected && canEdit && solo} color="var(--sh-ink-3)" />
      <svg className="wb-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <ShapeGeom shape={data.shape || 'rect'} fill={fill} stroke={stroke} />
      </svg>
      <NodeHandles />
      <EditBar id={id} data={data} type="shape" visible={!!selected && canEdit && solo} />
      {!selected && <DuplicateArrows nodeId={id} side={side} onArrowEnter={cancelHide} />}
      <NodeChrome id={id} data={data} />
      <EditableText id={id} data={data} placeholder="" className="wb-shape-text" />
    </div>
  );
}

// Mentioned-task card — a dedicated, read-only reference to an existing task.
// Deliberately distinct from the sticky/shape/text elements: a bordered card
// with a violet accent rail, a "TASK" tag, a done checkbox, the task number
// (opens the task), the title, and — for tasks from another list — a source
// breadcrumb. Connectable to other elements via the side arrows.
function TaskCardNode({ id, data, selected }: NodeProps<WBNode>) {
  const { canEdit, openTask, toggleDone, selectionCount } = useWB();
  const solo = selectionCount < 2;
  const { side, onMouseMove, onMouseLeave, cancelHide } = useNearestSide();
  const done = !!data.done;
  const loc = typeof data.taskList === 'string' ? data.taskList : '';
  return (
    <div className={`wb-taskcard ${done ? 'wb-taskcard-done' : ''}`} onMouseMove={canEdit ? onMouseMove : undefined} onMouseLeave={onMouseLeave}>
      <NodeResizer minWidth={184} minHeight={84} isVisible={!!selected && canEdit && solo} color="var(--sh-ink-3)" />
      <NodeHandles />
      <EditBar id={id} data={data} type="task" visible={!!selected && canEdit && solo} />
      {!selected && <DuplicateArrows nodeId={id} side={side} onArrowEnter={cancelHide} />}
      <div className="wb-taskcard-head">
        <button
          type="button"
          className="wb-taskcard-check nodrag"
          role="checkbox"
          aria-checked={done}
          disabled={!canEdit}
          title={done ? 'Mark not done' : 'Mark done'}
          onClick={(e) => { e.stopPropagation(); if (canEdit) toggleDone(id); }}
        >
          {done && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          )}
        </button>
        <span className="wb-taskcard-tag">{done ? 'Done' : 'Task'}</span>
        {data.taskNumber != null && <span className="wb-taskcard-num">#{data.taskNumber}</span>}
        <button type="button" className="wb-taskcard-open nodrag" title="Open task" onClick={(e) => { e.stopPropagation(); if (data.taskId) openTask(data.taskId); }}>
          Open
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H8M17 7v9" /></svg>
        </button>
      </div>
      <div className="wb-taskcard-title">{data.text || 'Untitled task'}</div>
      {loc && (
        <div className="wb-taskcard-loc">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
          <span>{loc}</span>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { sticky: StickyNode, text: TextNode, shape: ShapeNode, task: TaskCardNode };

const ARROW = { type: MarkerType.ArrowClosed } as const;
const edgeMarkers = (d?: { arrowStart?: boolean; arrowEnd?: boolean }) => ({
  markerStart: d?.arrowStart ? ARROW : undefined,
  markerEnd: d?.arrowEnd !== false ? ARROW : undefined,
});

// Custom connector: routes per data.lineType (straight / curved / elbow),
// carries an optional centre label (double-click to edit), and shows a toolbar
// (line style, arrowheads, delete) when selected.
function WBEdgeComponent({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerStart, markerEnd, selected, data, label }: EdgeProps) {
  const { canEdit, selectionCount, setEdgeLineType, cycleEdgeArrows, deleteEdge, editingEdgeId, startEditingEdge, stopEditing, setEdgeLabel, setEdgeWaypoint } = useWB();
  const rf = useReactFlow();
  const solo = selectionCount < 2;
  const editing = editingEdgeId === id;
  const labelText = typeof label === 'string' ? label : '';
  const lineType = (data?.lineType as WhiteboardLineType) || 'smoothstep';
  const wp = (data?.waypoint as { x: number; y: number } | null | undefined) || null;
  const args = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
  let path: string, labelX: number, labelY: number;
  if (wp) {
    // Quadratic bezier passing through the dragged waypoint at its midpoint.
    const cx = 2 * wp.x - 0.5 * (sourceX + targetX);
    const cy = 2 * wp.y - 0.5 * (sourceY + targetY);
    path = `M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`;
    labelX = wp.x; labelY = wp.y;
  } else {
    [path, labelX, labelY] =
      lineType === 'straight' ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : lineType === 'bezier' ? getBezierPath(args)
      : getSmoothStepPath(args);
  }
  // Drag the midpoint to bend the line (sets a waypoint in flow coords).
  const onBendDown = (e: React.PointerEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    const move = (ev: PointerEvent) => setEdgeWaypoint(id, rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }));
    const upH = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', upH); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', upH);
  };
  const styleBtn = (lt: WhiteboardLineType, title: string, d: string) => (
    <button type="button" className="wb-ebar-btn" data-active={lineType === lt} title={title} onClick={() => setEdgeLineType(id, lt)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
    </button>
  );
  return (
    <>
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={{ stroke: 'var(--sh-ink-3)', strokeWidth: 1.6 }} />
      {/* Centre label — double-click the line to add/edit it. */}
      {(editing || labelText) && (
        <EdgeLabelRenderer>
          {editing ? (
            <input
              autoFocus
              defaultValue={labelText}
              className="wb-edge-input nodrag nopan nowheel"
              style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
              onBlur={(e) => { setEdgeLabel(id, e.target.value); stopEditing(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
            />
          ) : (
            <div
              className="wb-edge-label nodrag nopan"
              style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
              onPointerDown={onBendDown}
              onDoubleClick={() => canEdit && startEditingEdge(id)}
            >
              {labelText}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
      {/* Bend handle (no label): drag to reshape the line, double-click to reset. */}
      {selected && canEdit && solo && !editing && !labelText && (
        <EdgeLabelRenderer>
          <div
            className="wb-edge-bend nodrag nopan"
            title="Drag to bend · double-click to reset"
            style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
            onPointerDown={onBendDown}
            onDoubleClick={() => setEdgeWaypoint(id, null)}
          />
        </EdgeLabelRenderer>
      )}
      {selected && canEdit && solo && (
        <EdgeLabelRenderer>
          <div className="wb-ebar wb-edge-bar nodrag nopan" style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${labelX}px,${labelY - 38}px)`, pointerEvents: 'all' }}>
            {styleBtn('straight', 'Straight', 'M4 12h16')}
            {styleBtn('bezier', 'Curved', 'M4 18 C 10 18, 14 6, 20 6')}
            {styleBtn('smoothstep', 'Elbow', 'M4 6h8v12h8')}
            <span className="wb-ebar-sep" />
            <button type="button" className="wb-ebar-btn" title="Arrowheads" onClick={() => cycleEdgeArrows(id)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h15M14 7l5 5-5 5" /></svg>
            </button>
            <span className="wb-ebar-sep" />
            <button type="button" className="wb-ebar-btn" title="Delete line" onClick={() => deleteEdge(id)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const edgeTypes = { wb: WBEdgeComponent };

// ── Serialization (strip React Flow runtime fields before persisting) ───────
function serialize(nodes: WBNode[], edges: WBEdge[], viewport?: WhiteboardData['viewport']): WhiteboardData {
  const sNodes: WhiteboardNode[] = nodes.map((n) => ({
    id: n.id,
    type: (n.type as WhiteboardNodeType) || 'sticky',
    position: n.position,
    width: n.width ?? n.measured?.width ?? null,
    height: n.height ?? n.measured?.height ?? null,
    zIndex: n.zIndex ?? null,
    data: {
      text: n.data.text ?? '',
      color: n.data.color,
      shape: n.data.shape,
      bold: n.data.bold,
      textColor: n.data.textColor,
      fontSize: n.data.fontSize,
      align: n.data.align,
      taskId: n.data.taskId ?? null,
      taskNumber: n.data.taskNumber ?? null,
      done: n.data.done,
      taskMention: n.data.taskMention ?? false,
      taskList: n.data.taskList ?? null,
    },
  }));
  const sEdges: WhiteboardEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    type: e.type,
    data: {
      lineType: ((e.data?.lineType as WhiteboardLineType) ?? 'smoothstep'),
      arrowStart: !!e.data?.arrowStart,
      arrowEnd: e.data?.arrowEnd !== false,
      waypoint: (e.data?.waypoint as { x: number; y: number } | null) ?? null,
    },
    label: typeof e.label === 'string' ? e.label : undefined,
  }));
  return { nodes: sNodes, edges: sEdges, viewport };
}

const defaultEdgeOptions = {
  type: 'wb' as const,
  markerEnd: { type: MarkerType.ArrowClosed },
};

// Map persisted WhiteboardData → React Flow nodes/edges. Shared by the initial
// seed and by undo/redo restore.
function toRFNodes(data: WhiteboardData): WBNode[] {
  return (data.nodes ?? []).map((n) => {
    const d = DEFAULT_SIZE[n.type];
    const sized = d ? { width: n.width ?? d.width, height: n.height ?? d.height } : {};
    return { id: n.id, type: n.type, position: n.position, ...sized, zIndex: n.zIndex ?? undefined, data: { ...n.data } };
  });
}
function toRFEdges(data: WhiteboardData): WBEdge[] {
  return (data.edges ?? []).map((e) => ({
    id: e.id, source: e.source, target: e.target,
    sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined,
    type: 'wb', data: e.data ?? { lineType: 'smoothstep', arrowEnd: true },
    ...edgeMarkers(e.data), label: e.label,
  }));
}

// ── Canvas (mounted once per list; seeded from the loaded blob) ─────────────
function Canvas({
  listId,
  initial,
  statuses,
  canEdit,
}: {
  listId: string;
  initial: WhiteboardData;
  statuses: SpaceStatus[];
  canEdit: boolean;
}) {
  const rf = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<WBNode>(toRFNodes(initial));
  const [edges, setEdges, onEdgesChange] = useEdgesState<WBEdge>(toRFEdges(initial));
  const { save } = useWhiteboardAutosave(listId);
  const createTask = useCreateTask(listId);
  const updateTask = useUpdateTask(listId);
  const [newColor, setNewColor] = useState(STICKY_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const startEditing = useCallback((id: string) => { setEditingId(id); setEditingEdgeId(null); }, []);
  const startEditingEdge = useCallback((id: string) => { setEditingEdgeId(id); setEditingId(null); }, []);
  const stopEditing = useCallback(() => { setEditingId(null); setEditingEdgeId(null); }, []);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [connectLine, setConnectLine] = useState<{ sx: number; sy: number; x: number; y: number } | null>(null);

  // Manual double-click detection: two clicks on the same node within 350ms.
  // More reliable than the native dblclick event, which React Flow's drag layer
  // can suppress (it preventDefaults mousedown) — single-click selection always
  // fires onNodeClick, so we derive the double-click from that.
  const lastClick = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  const onNodeClick = useCallback((e: React.MouseEvent, node: Node) => {
    if (!canEdit) return;
    const last = lastClick.current;
    if (last.id === node.id && e.timeStamp - last.t < 350) {
      setEditingId(node.id);
      lastClick.current = { id: '', t: 0 };
    } else {
      lastClick.current = { id: node.id, t: e.timeStamp };
    }
  }, [canEdit]);

  // Skip the very first autosave (it would just write back the loaded state).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    save(serialize(nodes, edges, rf.getViewport()));
  }, [nodes, edges, save, rf]);

  const updateNodeText = useCallback((id: string, text: string) => {
    const node = rf.getNode(id) as WBNode | undefined;
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n)));
    // If this element is a CONVERTED task, keep the task's title in sync with
    // the element's text (the element text IS the task name). A MENTION is just
    // a reference — editing the element must never rename the linked task (it
    // may live in another list), so skip the sync when data.taskMention is set.
    if (node?.data.taskId && !node.data.taskMention) {
      updateTask.mutate({ id: node.data.taskId, title: text.trim() || 'Untitled task' });
    }
  }, [rf, setNodes, updateTask]);

  const setNodeData = useCallback((id: string, patch: Partial<WhiteboardNodeData>) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [setNodes]);

  // ── Multi-selection (≥2 nodes) bulk actions, driven by GroupEditBar ──
  // Apply one data patch to every selected node at once.
  const patchSelection = useCallback((patch: Partial<WhiteboardNodeData>) => {
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [setNodes]);
  // Duplicate every selected node, offset down-right; the clones become the new
  // selection. Task links are dropped (mirrors single-node duplicate) but text
  // and look are kept — this is a real copy, not a fresh blank.
  const duplicateSelection = useCallback(() => {
    if (!canEdit) return;
    setNodes((nds) => {
      const sel = nds.filter((n) => n.selected);
      if (!sel.length) return nds;
      const GAP = 32;
      const clones: WBNode[] = sel.map((n) => {
        const type: WhiteboardNodeType = n.type === 'task' ? 'sticky' : ((n.type as WhiteboardNodeType) || 'sticky');
        const w = n.width ?? n.measured?.width ?? undefined;
        const h = n.height ?? n.measured?.height ?? undefined;
        const s = n.data;
        const data: WhiteboardNodeData = {
          text: s.text ?? '', color: s.color, shape: s.shape, bold: s.bold, textColor: s.textColor,
          fontSize: s.fontSize, align: s.align, taskId: null, taskNumber: null, done: false,
        };
        return {
          id: crypto.randomUUID(), type, position: { x: n.position.x + GAP, y: n.position.y + GAP },
          ...(w != null ? { width: w } : {}), ...(h != null ? { height: h } : {}), data, selected: true,
        };
      });
      return [...nds.map((n) => (n.selected ? { ...n, selected: false } : n)), ...clones];
    });
  }, [canEdit, setNodes]);
  // Delete the whole selection (routes through rf.deleteElements so the
  // whole-board guard and edge cleanup both run).
  const deleteSelection = useCallback(() => {
    if (!canEdit) return;
    const sel = rf.getNodes().filter((n) => n.selected);
    if (sel.length) rf.deleteElements({ nodes: sel.map((n) => ({ id: n.id })) });
  }, [canEdit, rf]);

  const convertToTask = useCallback((id: string) => {
    const node = rf.getNode(id) as WBNode | undefined;
    const title = (node?.data.text || '').trim() || 'Untitled task';
    createTask.mutate(
      { title, status: statuses[0]?.name },
      { onSuccess: (task: { id: string; display_number?: number | null }) => setNodeData(id, { taskId: task.id, taskNumber: task.display_number ?? null, done: false }) },
    );
  }, [rf, createTask, statuses, setNodeData]);

  // Mention (reference) an existing task from the element's edit bar. Unlike
  // convertToTask, this creates NO task and does NOT alter the selected element:
  // it drops a dedicated task CARD (its own node type) that references the task
  // just ABOVE the selected element. The card is flagged taskMention so editing
  // never renames the linked task (which may live in another list).
  const mentionTask = useCallback((id: string, task: MentionTask) => {
    const src = rf.getNode(id) as WBNode | undefined;
    // The card is a real sized node (draggable + resizable). Start at the default
    // size, centred over the element and stacked just above its top edge.
    const CARD_W = DEFAULT_SIZE.task!.width, CARD_H = DEFAULT_SIZE.task!.height, GAP = 24;
    const srcW = src?.width ?? src?.measured?.width ?? 180;
    const pos = src
      ? { x: src.position.x + srcW / 2 - CARD_W / 2, y: src.position.y - CARD_H - GAP }
      : { x: 0, y: 0 };
    const newId = crypto.randomUUID();
    const data: WhiteboardNodeData = {
      text: task.title || 'Untitled task',
      taskId: task.id,
      taskNumber: task.display_number ?? null,
      taskMention: true,
      done: task.done,
      taskList: task.subtitle ?? null,
    };
    setNodes((nds) => [
      ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
      { id: newId, type: 'task', position: pos, width: CARD_W, height: CARD_H, data, selected: true },
    ]);
  }, [rf, setNodes]);

  const unlinkTask = useCallback((id: string) => setNodeData(id, { taskId: null, taskNumber: null, done: false, taskMention: false }), [setNodeData]);
  const removeNode = useCallback((id: string) => setNodes((nds) => nds.filter((n) => n.id !== id)), [setNodes]);
  const openTask = useCallback((taskId: string) => usePMStore.getState().setActiveTask(taskId), []);

  // Checkbox on a task element marks the linked task complete / not-done. The
  // status field takes the literal category string 'done'/'todo' (same as the
  // list view's row checkbox — see TaskRow), not a space-status name.
  const toggleDone = useCallback((id: string) => {
    const node = rf.getNode(id) as WBNode | undefined;
    const taskId = node?.data.taskId;
    if (!taskId) return;
    const done = !node?.data.done;
    setNodeData(id, { done });
    updateTask.mutate({ id: taskId, status: done ? 'done' : 'todo' });
  }, [rf, setNodeData, updateTask]);

  // Duplicate a node to one side: clone its content + formatting + size, offset
  // in `position`'s direction, joined by an arrow. The task link is NOT copied —
  // the duplicate is an independent, plain element.
  // A clicked arrow can fire BOTH onClick and onConnectEnd; dedupe within 150ms
  // so a single click only duplicates once.
  const lastDup = useRef(0);
  const duplicateNode = useCallback((nodeId: string, position: Position) => {
    if (!canEdit) return;
    const now = performance.now();
    if (now - lastDup.current < 150) return;
    lastDup.current = now;
    const src = rf.getNode(nodeId) as WBNode | undefined;
    if (!src) return;
    // A task card is a reference, not a reusable shape — duplicating one yields a
    // fresh blank sticky rather than an empty (broken) task card.
    const type: WhiteboardNodeType = src.type === 'task' ? 'sticky' : ((src.type as WhiteboardNodeType) || 'sticky');
    const w = src.width ?? src.measured?.width ?? DEFAULT_SIZE[type]?.width ?? 180;
    const h = src.height ?? src.measured?.height ?? DEFAULT_SIZE[type]?.height ?? 120;
    const GAP = 64;
    const pos = { x: src.position.x, y: src.position.y };
    switch (position) {
      case Position.Left: pos.x -= w + GAP; break;
      case Position.Top: pos.y -= h + GAP; break;
      case Position.Bottom: pos.y += h + GAP; break;
      default: pos.x += w + GAP; // Right + fallback
    }
    const id = crypto.randomUUID();
    const s = src.data;
    // The duplicate keeps the source's look (type/shape/colour/formatting/size)
    // but starts with EMPTY text — it's a fresh element to fill in, not a copy.
    const data: WhiteboardNodeData = {
      text: '', color: s.color, shape: s.shape, bold: s.bold, fontSize: s.fontSize, align: s.align,
      taskId: null, taskNumber: null, done: false,
    };
    const sized = DEFAULT_SIZE[type] ? { width: w, height: h } : {};
    setNodes((nds) => [...nds, { id, type, position: pos, ...sized, data }]);
    const srcHandle = HANDLE_ID[position];
    const edgeData = { lineType: 'smoothstep' as WhiteboardLineType, arrowStart: false, arrowEnd: true };
    const edge: WBEdge = {
      id: crypto.randomUUID(),
      source: nodeId,
      target: id,
      sourceHandle: srcHandle,
      targetHandle: OPPOSITE[srcHandle],
      type: 'wb',
      data: edgeData,
      ...edgeMarkers(edgeData),
    };
    setEdges((eds) => addEdge(edge, eds));
  }, [canEdit, rf, setNodes, setEdges]);

  // Drag an arrow onto another element to connect them. We drive this ourselves
  // (rather than React Flow's connection system, whose drop-target hit-testing
  // was unreliable here): on pointer-down we track the drag; on release we
  // hit-test the element under the cursor and, if it's a node, add an edge.
  // A pure click (no drag) falls through to the arrow's onClick → duplicate.
  const startConnectDrag = useCallback((sourceId: string, side: Position, e: React.PointerEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = r.x + r.width / 2, sy = r.y + r.height / 2;
    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) dragging = true;
      if (dragging) setConnectLine({ sx, sy, x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setConnectLine(null);
      if (!dragging) return; // no drag → it's a click → onClick duplicates
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const targetEl = el?.closest('.react-flow__node') as HTMLElement | null;
      const targetId = targetEl?.getAttribute('data-id');
      if (!targetId || targetId === sourceId) return;
      // Attach to the side of the target nearest where the line was dropped.
      const tr = targetEl!.getBoundingClientRect();
      const dt = ev.clientY - tr.top, dr = tr.right - ev.clientX, db = tr.bottom - ev.clientY, dl = ev.clientX - tr.left;
      const tm = Math.min(dt, dr, db, dl);
      const th = tm === dt ? 't' : tm === dr ? 'r' : tm === db ? 'b' : 'l';
      const sh = HANDLE_ID[side];
      const data = { lineType: 'smoothstep' as WhiteboardLineType, arrowStart: false, arrowEnd: true };
      setEdges((eds) => addEdge({ id: crypto.randomUUID(), source: sourceId, target: targetId, sourceHandle: sh, targetHandle: th, type: 'wb', data, ...edgeMarkers(data) }, eds));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [canEdit, setEdges]);

  // ── Edge (line) toolbar actions ──
  const setEdgeLineType = useCallback((id: string, lineType: WhiteboardLineType) => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, lineType } } : e)));
  }, [setEdges]);
  const cycleEdgeArrows = useCallback((id: string) => {
    setEdges((eds) => eds.map((e) => {
      if (e.id !== id) return e;
      const start = !!e.data?.arrowStart, end = e.data?.arrowEnd !== false;
      // cycle: end-only → both → none → end-only
      const next = (end && !start) ? { arrowStart: true, arrowEnd: true }
        : (end && start) ? { arrowStart: false, arrowEnd: false }
        : { arrowStart: false, arrowEnd: true };
      const data = { ...e.data, ...next };
      return { ...e, data, ...edgeMarkers(data) };
    }));
  }, [setEdges]);
  const deleteEdge = useCallback((id: string) => setEdges((eds) => eds.filter((e) => e.id !== id)), [setEdges]);
  const setEdgeLabel = useCallback((id: string, label: string) => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, label: label.trim() || undefined } : e)));
  }, [setEdges]);
  const setEdgeWaypoint = useCallback((id: string, waypoint: { x: number; y: number } | null) => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, waypoint } } : e)));
  }, [setEdges]);

  // Keyboard layering for the selected element(s):
  //   ]  (or ⌘/Ctrl+])  → bring to front
  //   [  (or ⌘/Ctrl+[)  → send to back
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' && e.key !== ']') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const all = rf.getNodes();
      if (!all.some((n) => n.selected)) return;
      e.preventDefault();
      const zs = all.map((n) => n.zIndex ?? 0);
      const target = e.key === ']' ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
      setNodes((nds) => {
        let next = nds.map((n) => (n.selected ? { ...n, zIndex: target } : n));
        // Never let a z-index go negative: a node (and its toolbar) at z < 0
        // renders behind React Flow's interaction pane and stops being clickable.
        // When "send to back" would dip below 0, shift the whole stack up so the
        // lowest sits at 0 — relative order is preserved.
        const minZ = Math.min(0, ...next.map((n) => n.zIndex ?? 0));
        if (minZ < 0) next = next.map((n) => ({ ...n, zIndex: (n.zIndex ?? 0) - minZ }));
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, rf, setNodes]);

  // Manual double-click on a line → edit its label (mirrors the node approach).
  const lastEdgeClick = useRef<{ id: string; t: number }>({ id: '', t: 0 });
  const onEdgeClick = useCallback((e: React.MouseEvent, edge: Edge) => {
    if (!canEdit) return;
    const last = lastEdgeClick.current;
    if (last.id === edge.id && e.timeStamp - last.t < 350) { setEditingEdgeId(edge.id); lastEdgeClick.current = { id: '', t: 0 }; }
    else lastEdgeClick.current = { id: edge.id, t: e.timeStamp };
  }, [canEdit]);

  // Guard against an accidental whole-board wipe. The delete keys include
  // Backspace, so a select-all + Backspace can clear everything in one stroke
  // and the autosave then persists the empty board. Confirm when a single
  // delete would remove every element on the canvas; single/partial deletes
  // stay frictionless. (Server-side version history is the backstop — see
  // migration 114 — but this stops the mistake before it happens.)
  const onBeforeDelete = useCallback(async ({ nodes: dn }: { nodes: Node[]; edges: Edge[] }) => {
    if (!canEdit) return false;
    const remaining = rf.getNodes().length - dn.length;
    if (dn.length >= 2 && remaining <= 0) {
      return window.confirm(`Clear the whole whiteboard? This deletes all ${dn.length} elements.`);
    }
    return true;
  }, [canEdit, rf]);

  // ── Undo / redo (⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z or ⌘/Ctrl+Y) ──
  // Snapshots are coarse: a debounced recorder groups rapid changes (e.g. a
  // drag) into one history entry. Restores replay a snapshot back into RF.
  const history = useRef<{ past: WhiteboardData[]; future: WhiteboardData[]; last: WhiteboardData }>({ past: [], future: [], last: initial });
  const restoring = useRef(false);
  const histTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (restoring.current) { restoring.current = false; return; }
    if (histTimer.current) clearTimeout(histTimer.current);
    histTimer.current = setTimeout(() => {
      const snap = serialize(nodes, edges);
      const h = history.current;
      const key = (d: WhiteboardData) => JSON.stringify({ n: d.nodes, e: d.edges });
      if (key(h.last) === key(snap)) return;
      h.past.push(h.last);
      if (h.past.length > 60) h.past.shift();
      h.last = snap;
      h.future = [];
    }, 350);
  }, [nodes, edges]);
  const undo = useCallback(() => {
    const h = history.current;
    if (!h.past.length) return;
    if (histTimer.current) clearTimeout(histTimer.current);
    h.future.push(serialize(rf.getNodes() as WBNode[], rf.getEdges() as WBEdge[]));
    const prev = h.past.pop()!;
    h.last = prev;
    restoring.current = true;
    setNodes(toRFNodes(prev));
    setEdges(toRFEdges(prev));
  }, [rf, setNodes, setEdges]);
  const redo = useCallback(() => {
    const h = history.current;
    if (!h.future.length) return;
    if (histTimer.current) clearTimeout(histTimer.current);
    h.past.push(serialize(rf.getNodes() as WBNode[], rf.getEdges() as WBEdge[]));
    const next = h.future.pop()!;
    h.last = next;
    restoring.current = true;
    setNodes(toRFNodes(next));
    setEdges(toRFEdges(next));
  }, [rf, setNodes, setEdges]);
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, undo, redo]);

  // Current selection (derived from node state so it stays in sync with node
  // data — used both to gate per-node bars and to feed the group toolbar).
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selectedIds = useMemo(() => selectedNodes.map((n) => n.id), [selectedNodes]);
  const selectionCount = selectedIds.length;

  const ctx = useMemo<WhiteboardCtx>(
    () => ({ canEdit, listId, selectionCount, startConnectDrag, editingId, startEditing, stopEditing, updateNodeText, setNodeData, convertToTask, mentionTask, unlinkTask, removeNode, openTask, toggleDone, duplicateNode, setEdgeLineType, cycleEdgeArrows, deleteEdge, editingEdgeId, startEditingEdge, setEdgeLabel, setEdgeWaypoint }),
    [canEdit, listId, selectionCount, startConnectDrag, editingId, startEditing, stopEditing, updateNodeText, setNodeData, convertToTask, mentionTask, unlinkTask, removeNode, openTask, toggleDone, duplicateNode, setEdgeLineType, cycleEdgeArrows, deleteEdge, editingEdgeId, startEditingEdge, setEdgeLabel, setEdgeWaypoint],
  );

  // Place new nodes at the centre of the current viewport.
  const centerPosition = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [rf]);

  const addNode = useCallback((type: WhiteboardNodeType, extra: Partial<WhiteboardNodeData> = {}) => {
    const id = crypto.randomUUID();
    const data: WhiteboardNodeData = { text: '', taskId: null, taskNumber: null, ...extra };
    if (type === 'sticky') data.color = newColor;
    const base = centerPosition();
    const d = DEFAULT_SIZE[type];
    setNodes((nds) => {
      const o = (nds.length % 6) * 28;
      return [...nds, { id, type, position: { x: base.x + o, y: base.y + o }, ...(d ? { width: d.width, height: d.height } : {}), data }];
    });
  }, [setNodes, centerPosition, newColor]);

  // Full screen — request on the canvas wrapper so the board fills the display.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else wrapperRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  return (
    <WBContext.Provider value={ctx}>
      <div ref={wrapperRef} className="lv-canvas relative flex flex-1 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={(_, node) => { if (canEdit) startEditing(node.id); }}
          onEdgeClick={onEdgeClick}
          onEdgeDoubleClick={(_, edge) => { if (canEdit) startEditingEdge(edge.id); }}
          onMoveEnd={() => { if (!firstRun.current) save(serialize(nodes, edges, rf.getViewport())); }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          elevateNodesOnSelect={false}
          panOnScroll
          selectionOnDrag={canEdit}
          panOnDrag={canEdit ? [1, 2] : true}
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          zoomOnDoubleClick={false}
          defaultEdgeOptions={defaultEdgeOptions}
          defaultViewport={initial.viewport}
          fitView={!initial.viewport && (initial.nodes?.length ?? 0) > 0}
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          elementsSelectable={canEdit}
          deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
          onBeforeDelete={onBeforeDelete}
          proOptions={{ hideAttribution: true }}
          className="wb-flow"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls showInteractive={false} />

          {canEdit && (
            <GroupEditBar
              ids={selectedIds}
              nodes={selectedNodes}
              onPatch={patchSelection}
              onDuplicate={duplicateSelection}
              onDelete={deleteSelection}
            />
          )}

          <Panel position="top-right" className="wb-fs-panel">
            <button
              type="button"
              className="wb-fs-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 9H4m5 0V4m0 5L3 3m12 6h5m-5 0V4m0 5l6-6M9 15H4m5 0v5m0-5l-6 6m12-6h5m-5 0v5m0-5l6 6" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3m13-5v3a2 2 0 01-2 2h-3" />
                </svg>
              )}
              {isFullscreen ? 'Exit' : 'Fullscreen'}
            </button>
          </Panel>

          {canEdit && (
            <Panel position="top-left" className="wb-toolbar">
              <button type="button" className="wb-tool" onClick={() => addNode('sticky')} title="Add sticky note">
                <span className="wb-tool-swatch" style={{ background: newColor }} />
                Sticky
              </button>
              <button type="button" className="wb-tool" onClick={() => addNode('text')} title="Add text">
                <span className="wb-tool-ic" style={{ fontWeight: 800 }}>T</span>
                Text
              </button>
              <div className="wb-color-wrap">
                <button type="button" className="wb-tool" onClick={() => setShapeMenuOpen((o) => !o)} title="Add shape">
                  <span className="wb-tool-ic" style={{ border: '1.5px solid currentColor', width: 13, height: 11, borderRadius: 2 }} />
                  Shape
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: -1 }}><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {shapeMenuOpen && (
                  <ShapePicker onPick={(k) => { addNode('shape', { shape: k }); setShapeMenuOpen(false); }} />
                )}
              </div>
              <span className="wb-tool-sep" />
              <div className="wb-swatches">
                {STICKY_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="wb-swatch"
                    data-active={newColor === c}
                    style={{ background: c }}
                    onClick={() => setNewColor(c)}
                    title="Sticky color for new notes"
                    aria-label={`Sticky color ${c}`}
                  />
                ))}
              </div>
            </Panel>
          )}
        </ReactFlow>
        {canEdit && <GroupResizer nodes={selectedNodes} setNodes={setNodes} />}
        {connectLine && (
          <svg className="wb-connect-line" style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 9999 }}>
            <line x1={connectLine.sx} y1={connectLine.sy} x2={connectLine.x} y2={connectLine.y} stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 4" />
          </svg>
        )}
      </div>
    </WBContext.Provider>
  );
}

export default function WhiteboardView({
  listId,
  statuses,
  canEdit = true,
}: {
  listId: string;
  statuses: SpaceStatus[];
  canEdit?: boolean;
}) {
  const { data: wb, isLoading } = useWhiteboard(listId);

  if (isLoading || !wb) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[color:var(--sh-ink-3)]">Loading whiteboard…</p>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <Canvas key={listId} listId={listId} initial={wb} statuses={statuses} canEdit={canEdit} />
    </ReactFlowProvider>
  );
}
