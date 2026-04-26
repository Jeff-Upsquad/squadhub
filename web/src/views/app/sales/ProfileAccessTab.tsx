'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { ProfileAccessGrant, ProfileAccessGrantStatus } from '@squadhub/shared';
import ProfileAccessForm from './ProfileAccessForm';

type Status = ProfileAccessGrantStatus | 'all';

const STATUS_BADGE: Record<ProfileAccessGrantStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-amber-100 text-amber-700',
  revoked: 'bg-red-100 text-red-700',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProfileAccessTab(props: { adminMode?: boolean } = {}) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Status>('active');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileAccessGrant | null>(null);

  const basePath = props.adminMode ? '/admin/profile-access' : '/profile-access';
  const queryKey = useMemo(
    () => ['profile-access', basePath, statusFilter, search],
    [basePath, statusFilter, search],
  );

  const { data: listRes, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      api
        .get(basePath, { params: { status: statusFilter, search: search || undefined } })
        .then((r) => r.data),
  });
  const grants: ProfileAccessGrant[] = listRes?.data || [];

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`${basePath}/${id}/revoke`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile-access'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Revoke failed'),
  });

  const extendMutation = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      api.post(`${basePath}/${id}/extend`, { days }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile-access'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Extend failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`${basePath}/${id}`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile-access'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Delete failed'),
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {(['active', 'expired', 'revoked', 'all'] as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                statusFilter === s
                  ? 'bg-[var(--sh-ink)] text-white'
                  : 'text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email…"
            className="w-56 rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--sh-ink-3)]"
          />
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="rounded-md bg-[var(--sh-ink)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            + Create Grant
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-[var(--sh-ink-4)]">Loading…</p>
      ) : grants.length === 0 ? (
        <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] py-12 text-center">
          <p className="text-sm text-[var(--sh-ink-4)]">No grants{statusFilter !== 'all' ? ` (${statusFilter})` : ''} yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)]">
          <table className="w-full">
            <thead className="bg-[var(--sh-hair-3)] text-left text-xs font-medium uppercase tracking-wide text-[var(--sh-ink-3)]">
              <tr>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Categories</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Expires</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--sh-hair)] text-sm text-[var(--sh-ink)]">
              {grants.map((g) => {
                const status = g.status ?? 'active';
                return (
                  <tr key={g.id}>
                    <td className="px-4 py-2.5 font-medium">{g.email}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(g.categories || []).map((c) => (
                          <span
                            key={c.id}
                            className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                          >
                            {c.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_BADGE[status]}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--sh-ink-3)]">{formatDate(g.expires_at)}</td>
                    <td className="px-4 py-2.5 text-[var(--sh-ink-3)]">{formatDate(g.created_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-3 text-xs font-medium">
                        <button
                          onClick={() => {
                            setEditing(g);
                            setFormOpen(true);
                          }}
                          className="text-indigo-600 hover:underline"
                        >
                          Edit
                        </button>
                        {status !== 'revoked' && (
                          <button
                            onClick={() => {
                              const days = Number(prompt('Extend by how many days?', '7') || '');
                              if (!Number.isFinite(days) || days <= 0) return;
                              extendMutation.mutate({ id: g.id, days });
                            }}
                            className="text-indigo-600 hover:underline"
                          >
                            Extend
                          </button>
                        )}
                        {status !== 'revoked' && (
                          <button
                            onClick={() => {
                              if (confirm(`Revoke access for ${g.email}?`)) revokeMutation.mutate(g.id);
                            }}
                            className="text-red-600 hover:underline"
                          >
                            Revoke
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirm(`Delete grant for ${g.email}? This cannot be undone.`)) {
                              deleteMutation.mutate(g.id);
                            }
                          }}
                          className="text-[var(--sh-ink-4)] hover:text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <ProfileAccessForm
          basePath={basePath}
          grant={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['profile-access'] })}
        />
      )}
    </div>
  );
}
