import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

type SubTab = 'targets' | 'submissions';

interface TargetRow {
  client_id: string;
  kind: 'hours' | 'item';
  label: string;
  per_day: number;
  per_week: number;
  per_month: number;
}

function TargetsSection() {
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [rows, setRows] = useState<TargetRow[]>([]);

  const { data: usersRes } = useQuery({
    queryKey: ['admin-timesheet-users'],
    queryFn: () => api.get('/admin/timesheet/users').then((r) => r.data),
  });
  const { data: clientsRes } = useQuery({
    queryKey: ['admin-timesheet-clients'],
    queryFn: () => api.get('/admin/timesheet/clients').then((r) => r.data),
  });
  const { data: targetsRes } = useQuery({
    queryKey: ['admin-timesheet-targets', selectedUser],
    queryFn: () =>
      api.get('/admin/timesheet/targets', { params: { user_id: selectedUser } }).then((r) => r.data),
    enabled: !!selectedUser,
  });

  const users = usersRes?.data || [];
  const clients = clientsRes?.data || [];

  useEffect(() => {
    if (!targetsRes?.data) return;
    setRows(
      targetsRes.data.map((t: any) => ({
        client_id: t.client_id,
        kind: t.kind,
        label: t.label || '',
        per_day: Number(t.per_day) || 0,
        per_week: Number(t.per_week) || 0,
        per_month: Number(t.per_month) || 0,
      })),
    );
  }, [targetsRes]);

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/admin/timesheet/targets/${selectedUser}`, { targets: rows }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-timesheet-targets', selectedUser] });
      queryClient.invalidateQueries({ queryKey: ['admin-timesheet-users'] });
    },
  });

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { client_id: clients[0]?.id || '', kind: 'item', label: '', per_day: 0, per_week: 0, per_month: 0 },
    ]);
  const updateRow = (i: number, patch: Partial<TargetRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
      {/* User list */}
      <div className="rounded-xl border border-divider bg-surface">
        <div className="border-b border-divider px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-foreground-dim">
          Team
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          {users.map((u: any) => (
            <button
              key={u.id}
              onClick={() => setSelectedUser(u.id)}
              className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition ${
                selectedUser === u.id ? 'bg-canvas text-foreground' : 'text-foreground-muted hover:bg-canvas'
              }`}
            >
              <span className="truncate">{u.display_name}</span>
              {u.target_count > 0 && (
                <span className="ml-2 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                  {u.target_count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Target editor */}
      <div className="rounded-xl border border-divider bg-surface p-4">
        {!selectedUser ? (
          <div className="py-12 text-center text-sm text-foreground-dim">Select a team member to set targets.</div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">
                Targets — {users.find((u: any) => u.id === selectedUser)?.display_name}
              </h4>
              <button
                onClick={addRow}
                disabled={clients.length === 0}
                className="rounded-lg border border-divider px-3 py-1 text-xs font-medium text-foreground hover:bg-canvas disabled:opacity-50"
              >
                + Add target
              </button>
            </div>

            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-divider py-8 text-center text-xs text-foreground-dim">
                No targets. Add one per client.
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[1.4fr_0.8fr_1fr_0.6fr_0.6fr_0.6fr_auto] gap-2 px-1 text-[10px] font-medium uppercase text-foreground-dim">
                  <span>Client</span>
                  <span>Kind</span>
                  <span>Label</span>
                  <span>Day</span>
                  <span>Week</span>
                  <span>Month</span>
                  <span />
                </div>
                {rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1.4fr_0.8fr_1fr_0.6fr_0.6fr_0.6fr_auto] items-center gap-2">
                    <select
                      value={r.client_id}
                      onChange={(e) => updateRow(i, { client_id: e.target.value })}
                      className="rounded border border-divider bg-surface px-2 py-1 text-xs text-foreground"
                    >
                      {clients.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.business_name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={r.kind}
                      onChange={(e) => updateRow(i, { kind: e.target.value as 'hours' | 'item' })}
                      className="rounded border border-divider bg-surface px-2 py-1 text-xs text-foreground"
                    >
                      <option value="item">Items</option>
                      <option value="hours">Hours</option>
                    </select>
                    <input
                      type="text"
                      value={r.label}
                      placeholder={r.kind === 'hours' ? 'Hours' : 'e.g. Designs'}
                      onChange={(e) => updateRow(i, { label: e.target.value })}
                      className="rounded border border-divider bg-surface px-2 py-1 text-xs text-foreground"
                    />
                    {(['per_day', 'per_week', 'per_month'] as const).map((field) => (
                      <input
                        key={field}
                        type="number"
                        min={0}
                        step={r.kind === 'hours' ? 0.5 : 1}
                        value={r[field]}
                        onChange={(e) => updateRow(i, { [field]: parseFloat(e.target.value) || 0 })}
                        className="w-full rounded border border-divider bg-surface px-2 py-1 text-xs text-foreground"
                      />
                    ))}
                    <button
                      onClick={() => removeRow(i)}
                      className="rounded p-1 text-foreground-dim hover:bg-red-50 hover:text-red-600"
                      title="Remove"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="rounded-lg bg-sh-ink px-4 py-1.5 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Saving…' : 'Save targets'}
              </button>
              {saveMutation.isSuccess && <span className="text-xs text-emerald-600">Saved</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    on_time: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    late: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-500/15 dark:text-yellow-300',
    no_submission: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
  };
  const label: Record<string, string> = { on_time: 'On time', late: 'Late', no_submission: 'Missed' };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${map[status] || ''}`}>
      {label[status] || status}
    </span>
  );
}

function SubmissionsSection() {
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const { data: historyRes } = useQuery({
    queryKey: ['admin-timesheet-history', status, startDate, endDate],
    queryFn: () =>
      api
        .get('/admin/timesheet/history', {
          params: {
            status: status || undefined,
            start_date: startDate || undefined,
            end_date: endDate || undefined,
            limit: 50,
          },
        })
        .then((r) => r.data),
  });

  const rows = historyRes?.data || [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border border-divider bg-surface px-2 py-1 text-sm text-foreground"
        >
          <option value="">All statuses</option>
          <option value="on_time">On time</option>
          <option value="late">Late</option>
          <option value="no_submission">Missed</option>
        </select>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded border border-divider bg-surface px-2 py-1 text-sm text-foreground"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded border border-divider bg-surface px-2 py-1 text-sm text-foreground"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-divider bg-surface">
        <table className="w-full">
          <thead>
            <tr className="border-b border-divider text-left">
              <th className="px-4 py-2.5 text-xs font-medium text-foreground-muted">User</th>
              <th className="px-4 py-2.5 text-xs font-medium text-foreground-muted">Date</th>
              <th className="px-4 py-2.5 text-xs font-medium text-foreground-muted">Status</th>
              <th className="px-4 py-2.5 text-xs font-medium text-foreground-muted">Progress</th>
              <th className="px-4 py-2.5 text-xs font-medium text-foreground-muted">Report</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-foreground-dim">
                  No submissions found.
                </td>
              </tr>
            ) : (
              rows.map((r: any) => (
                <tr key={r.id} className="border-b border-divider align-top last:border-0">
                  <td className="px-4 py-2.5 text-sm text-foreground">{r.users?.display_name || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-foreground-muted">{r.date}</td>
                  <td className="px-4 py-2.5">{statusBadge(r.status)}</td>
                  <td className="px-4 py-2.5 text-xs text-foreground-muted">
                    {(r.progress || []).length === 0 ? (
                      <span className="text-foreground-dim">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {(r.progress || []).map((p: any, i: number) => (
                          <div key={i}>
                            <span className="text-foreground">{p.client_name}</span>:{' '}
                            {p.achieved_day}
                            {p.target_day > 0 ? `/${p.target_day}` : ''} {p.kind === 'hours' ? 'h' : p.label || 'items'}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-foreground-muted">
                    <span className="line-clamp-2 max-w-[260px]">{r.summary || '—'}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TimesheetAdminPanel() {
  const [sub, setSub] = useState<SubTab>('targets');
  return (
    <div>
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-canvas p-1">
        {(['targets', 'submissions'] as SubTab[]).map((s) => (
          <button
            key={s}
            onClick={() => setSub(s)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition ${
              sub === s ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {sub === 'targets' ? <TargetsSection /> : <SubmissionsSection />}
    </div>
  );
}
