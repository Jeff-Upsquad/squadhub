import { useMemo, useState, useEffect } from 'react';
import type { SpaceStatus } from '@squadhub/shared';
import type { RequestRowData } from '../atoms/RequestRow';
import { sortStages } from '../../../../../lib/designSpaceLists';
import TaskGroupCard from '../../TaskGroupCard';

// ---- Sort ----
type SortKey = 'newest' | 'oldest' | 'priority' | 'due' | 'title';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'priority', label: 'Priority' },
  { key: 'due', label: 'Due date' },
  { key: 'title', label: 'Title A–Z' },
];

// ---- Group ----
type GroupKey = 'status' | 'assignee' | 'priority' | 'none';
const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'priority', label: 'Priority' },
  { key: 'none', label: 'None' },
];

// The DB rejects 'normal' (see PriorityDot note), so 'none' is the middle value;
// fold both onto the same bucket/rank so they don't split into two groups.
const normPriority = (p: string): string => (p === 'normal' ? 'none' : p);
const PRIORITY_RANK: Record<string, number> = {
  emergency: 5,
  urgent: 4,
  high: 3,
  none: 2,
  low: 1,
};
const PRIORITY_LABEL: Record<string, string> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  high: 'High',
  none: 'Normal',
  low: 'Low',
};
const PRIORITY_COLOR: Record<string, string> = {
  emergency: 'var(--cd-danger)',
  urgent: 'var(--cd-danger)',
  high: 'var(--cd-review)',
  none: 'var(--cd-fg-2)',
  low: 'var(--cd-fg-3)',
};
const PRIORITY_GROUP_ORDER = ['emergency', 'urgent', 'high', 'none', 'low'];

const ts = (v: string | null | undefined): number => {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

function sortRequests(items: RequestRowData[], sort: SortKey): RequestRowData[] {
  const arr = [...items];
  switch (sort) {
    case 'newest':
      return arr.sort((a, b) => ts(b.created_at) - ts(a.created_at));
    case 'oldest':
      return arr.sort((a, b) => ts(a.created_at) - ts(b.created_at));
    case 'priority':
      return arr.sort(
        (a, b) =>
          (PRIORITY_RANK[normPriority(b.priority)] ?? 0) -
            (PRIORITY_RANK[normPriority(a.priority)] ?? 0) ||
          ts(b.created_at) - ts(a.created_at),
      );
    case 'due':
      // Soonest due first; tasks without a due date sink to the bottom.
      return arr.sort((a, b) => {
        const da = a.due_date ? ts(a.due_date) : Infinity;
        const db = b.due_date ? ts(b.due_date) : Infinity;
        return da - db;
      });
    case 'title':
      return arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    default:
      return arr;
  }
}

interface RequestGroup {
  key: string;
  label: string;
  color: string;
  items: RequestRowData[];
  listId: string | null;
}

function buildGroups(
  items: RequestRowData[],
  groupBy: GroupKey,
  sortedStages: SpaceStatus[],
  briefsListId: string | null,
): RequestGroup[] {
  if (groupBy === 'none') {
    return items.length
      ? [{ key: 'all', label: 'All requests', color: 'var(--cd-acc)', items, listId: null }]
      : [];
  }

  if (groupBy === 'priority') {
    const by: Record<string, RequestRowData[]> = {};
    for (const r of items) {
      const p = normPriority(r.priority);
      (by[p] = by[p] || []).push(r);
    }
    return PRIORITY_GROUP_ORDER.filter((k) => by[k]?.length).map((k) => ({
      key: `prio-${k}`,
      label: PRIORITY_LABEL[k] || k,
      color: PRIORITY_COLOR[k] || 'var(--cd-fg-3)',
      items: by[k],
      listId: null,
    }));
  }

  if (groupBy === 'assignee') {
    const by: Record<string, RequestRowData[]> = {};
    const names: Record<string, string> = {};
    for (const r of items) {
      const a = r.assignees?.[0];
      const id = a?.id || '__unassigned';
      (by[id] = by[id] || []).push(r);
      names[id] = a ? a.display_name || a.email || 'Unknown' : 'Unassigned';
    }
    const keys = Object.keys(by).sort((x, y) => {
      if (x === '__unassigned') return 1;
      if (y === '__unassigned') return -1;
      return names[x].localeCompare(names[y]);
    });
    return keys.map((id) => ({
      key: `asg-${id}`,
      label: names[id],
      color: id === '__unassigned' ? 'var(--cd-queued)' : 'var(--cd-progress)',
      items: by[id],
      listId: null,
    }));
  }

  // status (default) — one group per real 8-stage pipeline status, in order.
  const by: Record<string, RequestRowData[]> = {};
  for (const r of items) {
    const id = r._stage?.id;
    if (!id) continue;
    (by[id] = by[id] || []).push(r);
  }
  return sortedStages
    .filter((s) => by[s.id] && by[s.id].length > 0)
    .map((s) => ({
      key: s.id,
      label: s.name,
      color: s.color,
      items: by[s.id],
      listId: briefsListId,
    }));
}

const IconSettings = (p: { size?: number }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="8" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </svg>
);

/* View settings: one small button that opens Sort + Group as pill groups.
   Keeps the strip down to chips + a single control. */
function ViewSettings({
  sortBy,
  groupBy,
  onSort,
  onGroup,
}: {
  sortBy: SortKey;
  groupBy: GroupKey;
  onSort: (v: SortKey) => void;
  onGroup: (v: GroupKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const customised = sortBy !== 'newest' || groupBy !== 'status';
  return (
    <div className="cd-menu-wrap">
      <button
        type="button"
        className="cd-tool-btn cd-tool-btn-icon"
        data-on={customised}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="View settings"
        title="Sort & group"
      >
        <IconSettings size={15} />
      </button>
      {open && (
        <>
          <div className="cd-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="cd-menu cd-menu-right cd-settings" role="dialog" aria-label="View settings">
            <div className="cd-settings-section">
              <div className="cd-menu-head">Sort by</div>
              <div className="cd-seg" role="radiogroup" aria-label="Sort by">
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={o.key === sortBy}
                    className="cd-seg-btn"
                    data-active={o.key === sortBy}
                    onClick={() => onSort(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="cd-settings-section">
              <div className="cd-menu-head">Group by</div>
              <div className="cd-seg" role="radiogroup" aria-label="Group by">
                {GROUP_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={o.key === groupBy}
                    className="cd-seg-btn"
                    data-active={o.key === groupBy}
                    onClick={() => onGroup(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {customised && (
              <div className="cd-settings-foot">
                <button
                  type="button"
                  className="cd-menu-head-action"
                  onClick={() => {
                    onSort('newest');
                    onGroup('status');
                  }}
                >
                  Reset to default
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const SORT_STORAGE = 'cd.requests.sort';
const GROUP_STORAGE = 'cd.requests.group';

function readStored<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const v = window.localStorage.getItem(key) as T | null;
  return v && valid.includes(v) ? v : fallback;
}

export default function RequestsTab({
  requests,
  statuses,
  listByStatus,
  emptyHint,
  collapseCompletedByDefault = false,
}: {
  requests: RequestRowData[];
  statuses: SpaceStatus[];
  listByStatus: Record<string, { id: string; name: string } | null>;
  // Friendlier copy shown when the space has no requests at all (and no filters
  // are active) — e.g. an onboarding hint. Falls back to the "no match" message.
  emptyHint?: React.ReactNode;
  // Start the Closed stage group collapsed on load. Used by the merged Dashboard
  // so the long completed list doesn't dominate the view; the dedicated
  // Completed tab leaves it expanded.
  collapseCompletedByDefault?: boolean;
}) {
  const sortedStages = useMemo(() => sortStages(statuses), [statuses]);
  const briefsListId = listByStatus.queued?.id || null;
  const closedStageId = useMemo(
    () => sortedStages.find((s) => s.category === 'closed')?.id ?? null,
    [sortedStages],
  );

  // Stage ids the user has toggled on in the filter bar (empty = show all).
  const [activeFilters, setActiveFilters] = useState<Set<string>>(() => new Set());
  const [sortBy, setSortBy] = useState<SortKey>(() =>
    readStored(SORT_STORAGE, SORT_OPTIONS.map((o) => o.key), 'newest'),
  );
  const [groupBy, setGroupBy] = useState<GroupKey>(() =>
    readStored(GROUP_STORAGE, GROUP_OPTIONS.map((o) => o.key), 'status'),
  );

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(SORT_STORAGE, sortBy);
  }, [sortBy]);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(GROUP_STORAGE, groupBy);
  }, [groupBy]);

  const filtered = useMemo(() => {
    if (activeFilters.size === 0) return requests;
    return requests.filter((r) => (r._stage ? activeFilters.has(r._stage.id) : false));
  }, [requests, activeFilters]);

  const sorted = useMemo(() => sortRequests(filtered, sortBy), [filtered, sortBy]);

  const groups = useMemo(
    () => buildGroups(sorted, groupBy, sortedStages, briefsListId),
    [sorted, groupBy, sortedStages, briefsListId],
  );

  const toggleFilter = (id: string) => {
    const s = new Set(activeFilters);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setActiveFilters(s);
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of requests) {
      const id = r._stage?.id;
      if (id) counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }, [requests]);

  const noop = () => {};

  return (
    <div>
      <div className="cd-list-toolbar">
        {/* Every stage shows as a small chip — empty ones too, dimmed — so the
            pipeline is always fully visible. Chips are the filter (multi). */}
        <div className="cd-stage-chips" role="group" aria-label="Filter by stage">
          <button
            type="button"
            className="cd-chip cd-chip-all"
            data-active={activeFilters.size === 0}
            aria-pressed={activeFilters.size === 0}
            onClick={() => setActiveFilters(new Set())}
          >
            All
            <span className="n">{requests.length}</span>
          </button>
          {sortedStages.map((s) => {
            const n = statusCounts[s.id] || 0;
            return (
              <button
                key={s.id}
                type="button"
                className="cd-chip"
                data-active={activeFilters.has(s.id)}
                data-empty={n === 0}
                aria-pressed={activeFilters.has(s.id)}
                style={{ '--chip': s.color } as React.CSSProperties}
                onClick={() => toggleFilter(s.id)}
              >
                <span className="dot" />
                {s.name}
                <span className="n">{n}</span>
              </button>
            );
          })}
        </div>
        <ViewSettings sortBy={sortBy} groupBy={groupBy} onSort={setSortBy} onGroup={setGroupBy} />
      </div>

      {groups.length === 0 && (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            fontFamily: 'var(--cd-font-mono)',
            fontSize: 11,
            color: 'var(--cd-fg-3)',
          }}
        >
          {emptyHint && requests.length === 0 && activeFilters.size === 0
            ? emptyHint
            : 'No requests match the current filters'}
        </div>
      )}

      {groups.map((g) => (
        <TaskGroupCard
          key={g.key}
          groupKey={`design-requests-${groupBy}-${g.key}`}
          label={g.label}
          dotColor={g.color}
          tasks={g.items}
          allStatuses={statuses}
          listId={g.listId}
          onStatusChange={noop}
          defaultCollapsed={collapseCompletedByDefault && groupBy === 'status' && g.key === closedStageId}
        />
      ))}
      <div style={{ height: 40 }} />
    </div>
  );
}
