'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { ProfileAccessGrant, ProfileAccessGrantStatus } from '@squadhub/shared';

type Status = ProfileAccessGrantStatus | 'all';

interface SquadhireCategory {
  id: string;
  name: string;
  slug: string;
}

const STATUS_BADGE: Record<ProfileAccessGrantStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-amber-100 text-amber-700',
  revoked: 'bg-red-100 text-red-700',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function defaultExpiry(): string {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  d.setHours(23, 59, 0, 0);
  return d.toISOString().slice(0, 10);
}

function endOfDayIso(localDate: string): string {
  return new Date(`${localDate}T23:59:59.999Z`).toISOString();
}

export default function AdminProfileAccess() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Status>('active');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileAccessGrant | null>(null);

  const queryKey = useMemo(
    () => ['admin-profile-access', statusFilter, search],
    [statusFilter, search],
  );

  const { data: listRes, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      api
        .get('/admin/profile-access', { params: { status: statusFilter, search: search || undefined } })
        .then((r) => r.data),
  });
  const grants: ProfileAccessGrant[] = listRes?.data || [];

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/profile-access/${id}/revoke`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-profile-access'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Revoke failed'),
  });

  const extendMutation = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      api.post(`/admin/profile-access/${id}/extend`, { days }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-profile-access'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Extend failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/profile-access/${id}`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-profile-access'] }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Delete failed'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profile Access</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Email-gated public access to talent profiles. Synced with SquadHire (
          <code className="rounded bg-canvas px-1 py-0.5 text-xs">/talent-access</code>) — admins
          see every grant including ones originated on either side.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-divider bg-surface p-3">
        <div className="flex gap-1">
          {(['active', 'expired', 'revoked', 'all'] as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                statusFilter === s ? 'bg-slate-900 text-white' : 'text-foreground-muted hover:bg-canvas'
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
            className="w-56 rounded-md border border-divider bg-surface px-3 py-1.5 text-sm outline-none focus:border-slate-400"
          />
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            + Create Grant
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>
      ) : grants.length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface py-12 text-center">
          <p className="text-sm text-foreground-dim">
            No grants{statusFilter !== 'all' ? ` (${statusFilter})` : ''} yet.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-divider bg-surface">
          <table className="w-full">
            <thead className="bg-surface-alt text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Categories</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Expires</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5">Origin</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-foreground">
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
                    <td className="px-4 py-2.5 text-foreground-muted">{formatDate(g.expires_at)}</td>
                    <td className="px-4 py-2.5 text-foreground-muted">{formatDate(g.created_at)}</td>
                    <td className="px-4 py-2.5 text-foreground-muted">
                      {g.created_by ? 'SquadHub' : 'SquadHire'}
                    </td>
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
                          className="text-foreground-dim hover:text-red-600 hover:underline"
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
        <AdminProfileAccessForm
          grant={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['admin-profile-access'] })}
        />
      )}
    </div>
  );
}

function AdminProfileAccessForm({
  grant,
  onClose,
  onSaved,
}: {
  grant: ProfileAccessGrant | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!grant;
  const [email, setEmail] = useState(grant?.email ?? '');
  const [categoryIds, setCategoryIds] = useState<string[]>(grant?.category_ids ?? []);
  const [expiresOn, setExpiresOn] = useState<string>(
    grant?.expires_at ? grant.expires_at.slice(0, 10) : defaultExpiry(),
  );
  const [notes, setNotes] = useState<string>(grant?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!grant) return;
    setEmail(grant.email);
    setCategoryIds(grant.category_ids);
    setExpiresOn(grant.expires_at.slice(0, 10));
    setNotes(grant.notes ?? '');
  }, [grant?.id]);

  const { data: catRes, error: catErr } = useQuery({
    queryKey: ['squadhire-categories'],
    queryFn: () => api.get('/admin/integrations/squadhire/categories').then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });
  const categories: SquadhireCategory[] = catRes?.data || [];

  const submitMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        category_ids: categoryIds,
        expires_at: endOfDayIso(expiresOn),
        notes: notes.trim() || null,
      };
      if (!isEdit) payload.email = email.trim().toLowerCase();
      if (isEdit) {
        return api.patch(`/admin/profile-access/${grant!.id}`, payload).then((r) => r.data);
      }
      return api.post('/admin/profile-access', payload).then((r) => r.data);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || err.message || 'Save failed');
    },
  });

  const canSubmit =
    categoryIds.length > 0 && !!expiresOn && (isEdit || email.trim().length > 0);

  function toggleCategory(id: string) {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {isEdit ? 'Edit Grant' : 'Create Grant'}
          </h2>
          <button onClick={onClose} className="text-foreground-dim hover:text-foreground-muted">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isEdit}
              placeholder="grantee@example.com"
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-surface-alt disabled:text-foreground-dim"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Categories</label>
            {catErr ? (
              <p className="text-xs text-red-600">Failed to load categories.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => {
                  const on = categoryIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        on ? 'bg-indigo-600 text-white' : 'bg-canvas text-foreground-muted hover:bg-indigo-50'
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Expires on</label>
            <input
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              className="rounded-md border border-divider bg-surface px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Why this grant exists, follow-ups, etc."
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              setError(null);
              submitMutation.mutate();
            }}
            disabled={!canSubmit || submitMutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitMutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Create Grant'}
          </button>
        </div>
      </div>
    </div>
  );
}
