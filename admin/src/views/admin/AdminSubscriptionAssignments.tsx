'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

type Status = 'active' | 'ended' | 'all';

interface AssignmentTerm {
  id: string;
  card_id: string;
  recipient_type: 'talent' | 'partner';
  recipient_id: string;
  recipient_name: string | null;
  business_name: string | null;
  subscription_name: string | null;
  assigned_date: string;
  unassigned_date: string | null;
  work_start_date: string | null;
  work_end_date: string | null;
  status: 'active' | 'ended';
}

const STATUS_BADGE: Record<'active' | 'ended', string> = {
  active: 'bg-emerald-100 text-emerald-700',
  ended: 'bg-slate-100 text-slate-600',
};

function fmtTimestamp(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  // d is a plain YYYY-MM-DD calendar date.
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminSubscriptionAssignments() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Status>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AssignmentTerm | null>(null);

  const { data: listRes, isLoading } = useQuery({
    queryKey: ['admin-subscription-assignments', statusFilter, search],
    queryFn: () =>
      api
        .get('/admin/subscription-assignments', {
          params: { status: statusFilter, search: search || undefined },
        })
        .then((r) => r.data),
  });
  const rows: AssignmentTerm[] = listRes?.data || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Subscription Assignments</h1>
        <p className="mt-1 text-sm text-slate-500">
          Each talent assigned to a subscription card and their term. Assigned / unassigned dates are
          captured automatically; work start / end dates default to those and can be edited.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex gap-1">
          {(['active', 'ended', 'all'] as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                statusFilter === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search talent or business…"
          className="w-64 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-400"
        />
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white py-12 text-center">
          <p className="text-sm text-slate-400">
            No assignments{statusFilter !== 'all' ? ` (${statusFilter})` : ''} yet.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[860px]">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Business · Subscription</th>
                <th className="px-4 py-2.5">Talent</th>
                <th className="px-4 py-2.5">Assigned</th>
                <th className="px-4 py-2.5">Unassigned</th>
                <th className="px-4 py-2.5">Work start</th>
                <th className="px-4 py-2.5">Work end</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-900">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.business_name || '—'}</div>
                    {r.subscription_name && (
                      <div className="text-xs text-slate-400">{r.subscription_name}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.recipient_name || '—'}
                    {r.recipient_type === 'partner' && (
                      <span className="ml-1 text-[11px] text-slate-400">(partner)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{fmtTimestamp(r.assigned_date)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{fmtTimestamp(r.unassigned_date)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{fmtDate(r.work_start_date)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{fmtDate(r.work_end_date)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_BADGE[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => setEditing(r)}
                      className="text-xs font-medium text-indigo-600 hover:underline"
                    >
                      Edit dates
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditDatesModal
          term={editing}
          onClose={() => setEditing(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['admin-subscription-assignments'] })}
        />
      )}
    </div>
  );
}

function EditDatesModal({
  term,
  onClose,
  onSaved,
}: {
  term: AssignmentTerm;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [workStart, setWorkStart] = useState(term.work_start_date ?? '');
  const [workEnd, setWorkEnd] = useState(term.work_end_date ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWorkStart(term.work_start_date ?? '');
    setWorkEnd(term.work_end_date ?? '');
  }, [term.id]);

  const save = useMutation({
    mutationFn: () =>
      api
        .patch(`/admin/subscription-assignments/${term.id}`, {
          work_start_date: workStart || null,
          work_end_date: workEnd || null,
        })
        .then((r) => r.data),
    onSuccess: () => {
      showToast('Work dates updated.', 'success');
      onSaved();
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.error || err.message || 'Save failed'),
  });

  const invalid = !!workStart && !!workEnd && workEnd < workStart;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-1 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Edit work dates</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          {term.recipient_name || 'Talent'} · {term.business_name || '—'}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Work start date</label>
            <input
              type="date"
              value={workStart}
              onChange={(e) => setWorkStart(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Work end date</label>
            <input
              type="date"
              value={workEnd}
              onChange={(e) => setWorkEnd(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
        </div>

        <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          Assigned {fmtTimestamp(term.assigned_date)} · Unassigned {fmtTimestamp(term.unassigned_date)} (auto-captured)
        </div>

        {invalid && (
          <p className="mt-2 text-xs text-red-600">Work end date can’t be before the start date.</p>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              setError(null);
              save.mutate();
            }}
            disabled={invalid || save.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
