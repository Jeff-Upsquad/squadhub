import { useMemo, useState, useEffect } from 'react';
import type { SpaceStatus } from '@squadhub/shared';
import type { RequestRowData } from '../atoms/RequestRow';
import { STATUS_LABELS } from '../atoms/StatusPill';
import type { RequestStatus } from '../atoms/StatusPill';
import { IconFilter, IconSort, IconGrid } from '../atoms/Icons';
import TaskGroupCard from '../../TaskGroupCard';

const STATUS_ORDER: RequestStatus[] = ['progress', 'review', 'queued', 'done'];
const STATUS_COLOR: Record<RequestStatus, string> = {
  queued: 'var(--cd-queued)',
  progress: 'var(--cd-progress)',
  review: 'var(--cd-review)',
  done: 'var(--cd-done)',
};

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
  listByStatus: Record<string, { id: string; name: string } | null>,
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

  // status (default)
  const by: Record<string, RequestRowData[]> = {};
  for (const r of items) {
    (by[r._derivedStatus] = by[r._derivedStatus] || []).push(r);
  }
  return STATUS_ORDER.filter((k) => by[k] && by[k].length > 0).map((k) => ({
    key: k,
    label: STATUS_LABELS[k],
    color: STATUS_COLOR[k],
    items: by[k],
    listId: listByStatus[k]?.id || null,
  }));
}

function ToolbarMenu<T extends string>({
  icon,
  prefix,
  value,
  options,
  align = 'right',
  onChange,
}: {
  icon: React.ReactNode;
  prefix: string;
  value: T;
  options: { key: T; label: string }[];
  align?: 'left' | 'right';
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value);
  return (
    <div className="cd-menu-wrap">
      <button
        className="cd-topbar-btn"
        style={{ border: '1px solid var(--cd-br-0)' }}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon} {prefix}: {current?.label ?? ''}
      </button>
      {open && (
        <>
          <div className="cd-menu-backdrop" onClick={() => setOpen(false)} />
          <div className={`cd-menu cd-menu-${align}`} role="menu">
            {options.map((o) => (
              <button
                key={o.key}
                role="menuitemradio"
                aria-checked={o.key === value}
                className={`cd-menu-item${o.key === value ? ' active' : ''}`}
                onClick={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
              >
                {o.label}
                <svg
                  className="check"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </button>
            ))}
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
  filterStatus,
  statuses,
  listByStatus,
  emptyHint,
  collapseCompletedByDefault = false,
}: {
  requests: RequestRowData[];
  filterStatus?: RequestStatus | null;
  statuses: SpaceStatus[];
  listByStatus: Record<string, { id: string; name: string } | null>;
  // Friendlier copy shown when the space has no requests at all (and no filters
  // are active) — e.g. an onboarding hint. Falls back to the "no match" message.
  emptyHint?: React.ReactNode;
  // Start the Completed (done) status group collapsed on load. Used by the
  // merged Dashboard so the long completed list doesn't dominate the view; the
  // dedicated Completed tab leaves it expanded.
  collapseCompletedByDefault?: boolean;
}) {
  const [activeFilters, setActiveFilters] = useState<Set<RequestStatus>>(() => {
    const s = new Set<RequestStatus>();
    if (filterStatus) s.add(filterStatus);
    return s;
  });
  const [sortBy, setSortBy] = useState<SortKey>(() =>
    readStored(SORT_STORAGE, SORT_OPTIONS.map((o) => o.key), 'newest'),
  );
  const [groupBy, setGroupBy] = useState<GroupKey>(() =>
    readStored(GROUP_STORAGE, GROUP_OPTIONS.map((o) => o.key), 'status'),
  );

  useEffect(() => {
    if (filterStatus) setActiveFilters(new Set([filterStatus]));
  }, [filterStatus]);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(SORT_STORAGE, sortBy);
  }, [sortBy]);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(GROUP_STORAGE, groupBy);
  }, [groupBy]);

  const filtered = useMemo(() => {
    if (activeFilters.size === 0) return requests;
    return requests.filter((r) => activeFilters.has(r._derivedStatus));
  }, [requests, activeFilters]);

  const sorted = useMemo(() => sortRequests(filtered, sortBy), [filtered, sortBy]);

  const groups = useMemo(
    () => buildGroups(sorted, groupBy, listByStatus),
    [sorted, groupBy, listByStatus],
  );

  const toggleFilter = (k: RequestStatus) => {
    const s = new Set(activeFilters);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    setActiveFilters(s);
  };

  const statusCounts: Record<RequestStatus, number> = {
    queued: 0,
    progress: 0,
    review: 0,
    done: 0,
  };
  for (const r of requests) statusCounts[r._derivedStatus]++;

  const noop = () => {};

  return (
    <div>
      <div className="cd-list-toolbar">
        <button className="cd-topbar-btn" style={{ border: '1px solid var(--cd-br-0)' }}>
          <IconFilter size={12} /> Filter
        </button>
        {STATUS_ORDER.map((k) => (
          <button
            key={k}
            className={`cd-filter-chip${activeFilters.has(k) ? ' active' : ''}`}
            onClick={() => toggleFilter(k)}
          >
            <span
              style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[k] }}
            />
            {STATUS_LABELS[k]}
            <span className="count">{statusCounts[k]}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <ToolbarMenu
          icon={<IconSort size={12} />}
          prefix="Sort"
          value={sortBy}
          options={SORT_OPTIONS}
          onChange={setSortBy}
        />
        <ToolbarMenu
          icon={<IconGrid size={12} />}
          prefix="Group"
          value={groupBy}
          options={GROUP_OPTIONS}
          onChange={setGroupBy}
        />
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
          defaultCollapsed={collapseCompletedByDefault && g.key === 'done'}
        />
      ))}
      <div style={{ height: 40 }} />
    </div>
  );
}
