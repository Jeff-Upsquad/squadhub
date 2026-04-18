import { useMemo, useState, useEffect } from 'react';
import type { RequestRowData } from '../atoms/RequestRow';
import RequestRow from '../atoms/RequestRow';
import { STATUS_LABELS } from '../atoms/StatusPill';
import type { RequestStatus } from '../atoms/StatusPill';
import { IconCaret, IconFilter, IconSort, IconGrid } from '../atoms/Icons';

const STATUS_ORDER: RequestStatus[] = ['progress', 'review', 'queued', 'done'];
const STATUS_COLOR: Record<RequestStatus, string> = {
  queued: 'var(--cd-queued)',
  progress: 'var(--cd-progress)',
  review: 'var(--cd-review)',
  done: 'var(--cd-done)',
};

export default function RequestsTab({
  requests,
  onOpenRequest,
  filterStatus,
}: {
  requests: RequestRowData[];
  onOpenRequest: (r: RequestRowData) => void;
  filterStatus?: RequestStatus | null;
}) {
  const [activeFilters, setActiveFilters] = useState<Set<RequestStatus>>(() => {
    const s = new Set<RequestStatus>();
    if (filterStatus) s.add(filterStatus);
    return s;
  });
  const [collapsed, setCollapsed] = useState<Set<RequestStatus>>(new Set());

  useEffect(() => {
    if (filterStatus) setActiveFilters(new Set([filterStatus]));
  }, [filterStatus]);

  const filtered = useMemo(() => {
    if (activeFilters.size === 0) return requests;
    return requests.filter((r) => activeFilters.has(r._derivedStatus));
  }, [requests, activeFilters]);

  const groups = useMemo(() => {
    const by: Record<string, RequestRowData[]> = {};
    for (const r of filtered) {
      (by[r._derivedStatus] = by[r._derivedStatus] || []).push(r);
    }
    return STATUS_ORDER.filter((k) => by[k] && by[k].length > 0).map((k) => ({
      key: k,
      label: STATUS_LABELS[k],
      items: by[k],
    }));
  }, [filtered]);

  const toggleFilter = (k: RequestStatus) => {
    const s = new Set(activeFilters);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    setActiveFilters(s);
  };

  const toggleCollapsed = (k: RequestStatus) => {
    const s = new Set(collapsed);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    setCollapsed(s);
  };

  const statusCounts: Record<RequestStatus, number> = {
    queued: 0,
    progress: 0,
    review: 0,
    done: 0,
  };
  for (const r of requests) statusCounts[r._derivedStatus]++;

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
        <button className="cd-topbar-btn" style={{ border: '1px solid var(--cd-br-0)' }}>
          <IconSort size={12} /> Sort: Newest
        </button>
        <button className="cd-topbar-btn" style={{ border: '1px solid var(--cd-br-0)' }}>
          <IconGrid size={12} /> Group: Status
        </button>
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
          No requests match the current filters
        </div>
      )}

      {groups.map((g) => (
        <div
          key={g.key}
          className={`cd-list-group${collapsed.has(g.key) ? ' collapsed' : ''}`}
        >
          <div className="cd-list-group-head" onClick={() => toggleCollapsed(g.key)}>
            <IconCaret size={12} className="caret" />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: STATUS_COLOR[g.key],
              }}
            />
            {g.label}
            <span className="mono">{g.items.length}</span>
          </div>
          <div className="cd-list-head-row">
            <span />
            <span>ID</span>
            <span>Title</span>
            <span>Assigned</span>
            <span>Timer</span>
            <span className="right">Due</span>
            <span />
          </div>
          {g.items.map((r) => (
            <RequestRow key={r.id} request={r} onClick={() => onOpenRequest(r)} />
          ))}
        </div>
      ))}
      <div style={{ height: 40 }} />
    </div>
  );
}
