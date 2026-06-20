'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { FeatureTipRow, RosterData, RosterRow } from './types';

type Filter = 'all' | 'accepted' | 'snoozed' | 'pending';

export default function FeatureTipRoster({
  tip,
  onClose,
}: {
  tip: FeatureTipRow;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const close = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const [revision, setRevision] = useState<number | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>('all');

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-feature-tip-roster', tip.id, revision],
    queryFn: () =>
      api
        .get(`/admin/feature-tips/${tip.id}/roster${revision ? `?revision=${revision}` : ''}`)
        .then((r) => r.data),
  });
  const roster: RosterData | undefined = res?.data;

  const rows = useMemo(() => {
    const all = roster?.rows || [];
    return filter === 'all' ? all : all.filter((r) => r.status === filter);
  }, [roster, filter]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-divider bg-surface shadow-2xl transition-transform duration-200 ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between border-b border-divider px-6 py-4">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-foreground">Roster</h3>
            <p className="line-clamp-1 text-xs text-foreground-muted">{tip.title}</p>
          </div>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-dim transition hover:bg-surface-alt hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="border-b border-divider px-6 py-4">
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Accepted" value={roster?.counts.accepted} tone="text-emerald-600" />
            <Stat label="Snoozed" value={roster?.counts.snoozed} tone="text-amber-600" />
            <Stat label="Pending" value={roster?.counts.pending} tone="text-foreground" />
            <Stat label="Total" value={roster?.counts.total} tone="text-foreground-muted" />
          </div>

          {(roster?.available_revisions?.length ?? 0) > 1 && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[11px] text-foreground-dim">Round</span>
              <select
                value={revision ?? roster?.current_revision ?? 1}
                onChange={(e) => setRevision(Number(e.target.value))}
                className="rounded-md border border-divider-strong bg-surface px-2 py-1 text-xs text-foreground"
              >
                {roster?.available_revisions.map((r) => (
                  <option key={r} value={r}>
                    r{r}
                    {r === roster?.current_revision ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-3 flex gap-1">
            {(['all', 'accepted', 'snoozed', 'pending'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${
                  filter === f ? 'bg-surface-alt text-foreground' : 'text-foreground-muted hover:bg-surface-alt'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-foreground-muted">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-foreground-muted">No users in this group.</div>
          ) : (
            <ul className="divide-y divide-divider">
              {rows.map((r) => (
                <RosterRowItem key={r.user.id} row={r} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value?: number; tone: string }) {
  return (
    <div>
      <div className={`text-xl font-semibold ${tone}`}>{value ?? '—'}</div>
      <div className="text-[10px] uppercase tracking-wider text-foreground-dim">{label}</div>
    </div>
  );
}

function RosterRowItem({ row }: { row: RosterRow }) {
  const badge =
    row.status === 'accepted'
      ? 'bg-emerald-50 text-emerald-600'
      : row.status === 'snoozed'
        ? 'bg-amber-50 text-amber-600'
        : 'bg-surface-alt text-foreground-muted';
  const when =
    row.status === 'accepted' && row.accepted_at
      ? `Accepted ${new Date(row.accepted_at).toLocaleString()}`
      : row.status === 'snoozed' && row.dismissed_until
        ? `Reminds ${new Date(row.dismissed_until).toLocaleString()}`
        : '';
  return (
    <li className="flex items-center gap-3 px-6 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-well text-sm font-semibold text-foreground">
        {(row.user.display_name?.[0] || '?').toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{row.user.display_name}</div>
        {when && <div className="truncate text-[11px] text-foreground-dim">{when}</div>}
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${badge}`}>
        {row.status}
      </span>
    </li>
  );
}
