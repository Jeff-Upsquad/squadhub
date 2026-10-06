import type { ListViewColumnId, ListViewColumnState } from '@squadhub/shared';

export type { ListViewColumnId, ListViewColumnState };

export interface ColumnDef {
  id: ListViewColumnId;
  label: string;
  width: string;
  /** Visible for fresh views / when the stored prefs predate this column. */
  defaultVisible: boolean;
}

export const COLUMN_DEFS: ColumnDef[] = [
  { id: 'status', label: 'Status', width: '110px', defaultVisible: false },
  { id: 'priority', label: 'Priority', width: '84px', defaultVisible: true },
  { id: 'assignee', label: 'Assignee', width: '64px', defaultVisible: true },
  { id: 'labels', label: 'Labels', width: '110px', defaultVisible: false },
  { id: 'type', label: 'Type', width: '100px', defaultVisible: false },
  { id: 'startDate', label: 'Start date', width: '96px', defaultVisible: false },
  { id: 'workDate', label: 'Work date', width: '100px', defaultVisible: true },
  { id: 'dueDate', label: 'Due date', width: '90px', defaultVisible: true },
  { id: 'estimate', label: 'Time estimate', width: '85px', defaultVisible: false },
  { id: 'tracked', label: 'Time tracked', width: '85px', defaultVisible: false },
  { id: 'taskId', label: 'Custom Task ID', width: '96px', defaultVisible: false },
  { id: 'createdBy', label: 'Created by', width: '96px', defaultVisible: false },
  { id: 'latestComment', label: 'Latest comment', width: '150px', defaultVisible: false },
  { id: 'comments', label: 'Comments', width: '70px', defaultVisible: false },
  { id: 'dateCreated', label: 'Date created', width: '96px', defaultVisible: false },
  { id: 'dateCompleted', label: 'Date completed', width: '110px', defaultVisible: false },
];

export const DEFAULT_COLUMNS: ListViewColumnState[] = COLUMN_DEFS.map((d) => ({
  id: d.id,
  visible: d.defaultVisible,
}));

/** Visible column ids for a fresh view (what users see before customizing). */
export const DEFAULT_VISIBLE_IDS: ListViewColumnId[] = COLUMN_DEFS.filter((d) => d.defaultVisible).map(
  (d) => d.id,
);

const VALID_IDS = new Set<ListViewColumnId>(COLUMN_DEFS.map((d) => d.id));

/** Normalize any stored column array: drop unknown ids, append missing defaults, cap at defs length. */
export function normalizeColumns(input?: ListViewColumnState[] | null): ListViewColumnState[] {
  if (!Array.isArray(input) || input.length === 0) return [...DEFAULT_COLUMNS];
  const seen = new Set<ListViewColumnId>();
  const out: ListViewColumnState[] = [];
  for (const c of input) {
    if (!c || !VALID_IDS.has(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, visible: c.visible !== false });
  }
  for (const d of DEFAULT_COLUMNS) {
    if (!seen.has(d.id)) out.push({ ...d });
  }
  return out.slice(0, COLUMN_DEFS.length);
}

/** Everything a surface needs to render + edit one view's field columns. */
export interface ColumnControls {
  /** Full ordered states (visible + hidden). */
  states: ListViewColumnState[];
  onChange: (next: ListViewColumnState[]) => void;
  onReset?: () => void;
  hasOverride?: boolean;
  /** Opens the full field-manager drawer (header "+" button). */
  onOpenManager?: () => void;
}

/** Ordered list of visible column ids. */
export function visibleColumnIds(columns?: ListViewColumnState[] | null): ListViewColumnId[] {
  return normalizeColumns(columns)
    .filter((c) => c.visible)
    .map((c) => c.id);
}

/**
 * Effective columns for a scope: personal override (columnPrefsByScope) wins,
 * else the shared view config (list_views.config.columns), else defaults.
 */
export function resolveColumns(
  viewConfigColumns?: ListViewColumnState[] | null,
  personalOverride?: ListViewColumnState[] | null,
): ListViewColumnState[] {
  if (Array.isArray(personalOverride) && personalOverride.length > 0) {
    return normalizeColumns(personalOverride);
  }
  return normalizeColumns(viewConfigColumns);
}

/** Grid template for TaskGroupCard header + TaskRow, given visible columns. */
export function gridTemplateFor(visible: ListViewColumnId[]): string {
  const widthById = new Map<ListViewColumnId, string>(COLUMN_DEFS.map((d) => [d.id, d.width]));
  const cols = visible.map((id) => widthById.get(id) ?? '80px').join(' ');
  // 22px chevron + 1fr title + dynamic columns + 24px more button
  return cols ? `22px minmax(0,1fr) ${cols} 24px` : `22px minmax(0,1fr) 24px`;
}

export function toggleColumnVisibility(
  columns: ListViewColumnState[],
  id: ListViewColumnId,
): ListViewColumnState[] {
  return columns.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
}

export function moveColumn(
  columns: ListViewColumnState[],
  id: ListViewColumnId,
  dir: -1 | 1,
): ListViewColumnState[] {
  const idx = columns.findIndex((c) => c.id === id);
  const next = idx + dir;
  if (idx < 0 || next < 0 || next >= columns.length) return columns;
  const out = [...columns];
  [out[idx], out[next]] = [out[next], out[idx]];
  return out;
}
