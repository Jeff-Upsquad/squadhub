'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

type Permission = 'view' | 'edit' | 'full';
type SubjectType = 'role' | 'user';

interface Grant {
  category: string;
  subject_type: SubjectType;
  subject_id: string;
  subject_name: string;
  subject_email: string | null;
  permission: Permission;
}
interface RoleLite {
  id: string;
  name: string;
}
interface UserLite {
  id: string;
  email: string | null;
  display_name: string;
  user_type?: string;
}

// Humanised label for non-internal grantees (internal staff need no badge).
const USER_TYPE_LABEL: Record<string, string> = { partner_employee: 'Partner' };
interface AccessData {
  categories: string[];
  roles: RoleLite[];
  users: UserLite[];
  grants: Grant[];
}

const CAT_LABEL: Record<string, string> = { creative: 'Creative', accountant: 'Accountant', sales: 'Sales' };
const CAT_DESC: Record<string, string> = {
  creative: 'Designers, video editors, and other creative roles.',
  accountant: 'Bookkeeping, audit, tax, and finance professionals.',
  sales: 'Sales, business development, and account management.',
};
const PERMISSIONS: { value: Permission; label: string }[] = [
  { value: 'view', label: 'View' },
  { value: 'edit', label: 'Edit' },
  { value: 'full', label: 'Full' },
];
const PERM_HINT: Record<Permission, string> = {
  view: 'Read-only',
  edit: 'Update status & notes',
  full: 'Full, incl. delete',
};

const selectClass =
  'rounded-md border border-divider-strong bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-[var(--color-accent)]';

export default function AdminCandidateAccess() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('creative');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<AccessData>({
    queryKey: ['admin-candidate-access'],
    queryFn: async () => (await api.get('/admin/candidate-access')).data.data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-candidate-access'] });
  const grant = useMutation({
    mutationFn: (v: { category: string; subject_type: SubjectType; subject_id: string; permission: Permission }) =>
      api.post('/admin/candidate-access/grant', v).then((r) => r.data),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (v: { category: string; subject_type: SubjectType; subject_id: string }) =>
      api.delete('/admin/candidate-access/grant', { data: v }).then((r) => r.data),
    onSuccess: invalidate,
  });

  const categories = data?.categories ?? ['creative', 'accountant', 'sales'];
  const grants = data?.grants ?? [];
  const countFor = (c: string) => grants.filter((g) => g.category === c).length;
  const catGrants = grants.filter((g) => g.category === selected);
  const roleGrants = catGrants.filter((g) => g.subject_type === 'role');
  const userGrants = catGrants.filter((g) => g.subject_type === 'user');

  // Add-picker: roles + internal users not already granted in this category.
  const grantedKeys = new Set(catGrants.map((g) => `${g.subject_type}:${g.subject_id}`));
  const q = search.trim().toLowerCase();
  const roleResults = (data?.roles ?? []).filter(
    (r) => !grantedKeys.has(`role:${r.id}`) && (!q || r.name.toLowerCase().includes(q)),
  );
  const userResults = (data?.users ?? []).filter(
    (u) =>
      !grantedKeys.has(`user:${u.id}`) &&
      (!q || (u.display_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)),
  );

  const pick = (subject_type: SubjectType, subject_id: string) =>
    grant.mutate({ category: selected, subject_type, subject_id, permission: 'view' });

  const GrantRow = ({ g }: { g: Grant }) => (
    <div className="flex items-center justify-between gap-3 border-b border-divider px-4 py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{g.subject_name}</span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase ${
              g.subject_type === 'role' ? 'bg-violet-500/10 text-violet-500' : 'bg-foreground/10 text-foreground-muted'
            }`}
          >
            {g.subject_type}
          </span>
        </div>
        {g.subject_email && <div className="truncate text-xs text-foreground-dim">{g.subject_email}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <select
          className={selectClass}
          value={g.permission}
          disabled={grant.isPending}
          onChange={(e) =>
            grant.mutate({
              category: selected,
              subject_type: g.subject_type,
              subject_id: g.subject_id,
              permission: e.target.value as Permission,
            })
          }
        >
          {PERMISSIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label} — {PERM_HINT[p.value]}
            </option>
          ))}
        </select>
        <button
          onClick={() => remove.mutate({ category: selected, subject_type: g.subject_type, subject_id: g.subject_id })}
          disabled={remove.isPending}
          className="text-xs font-medium text-red-500 hover:underline disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Candidate Access</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Pick a candidate category, then add the roles or users who may access it — and at what level.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-divider bg-canvas px-4 py-3 text-sm text-foreground-muted">
        <span className="font-medium text-foreground">How it works:</span> access is{' '}
        <span className="font-medium">deny-by-default</span> — a user sees a category only if it&apos;s granted to them
        directly <span className="italic">or</span> via one of their roles.{' '}
        <span className="font-medium text-foreground">View</span> = read-only,{' '}
        <span className="font-medium text-foreground">Edit</span> = update status &amp; notes,{' '}
        <span className="font-medium text-foreground">Full</span> = everything incl. delete. When someone has both a
        direct and a role grant, the higher level wins. Admins get full access by default — but a grant here applies to
        them too, capping their level for that category.
      </div>

      {isLoading || !data ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>
      ) : (
        <>
          {/* Category cards */}
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {categories.map((c) => {
              const active = c === selected;
              return (
                <button
                  key={c}
                  onClick={() => {
                    setSelected(c);
                    setAdding(false);
                    setSearch('');
                  }}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    active
                      ? 'border-[var(--color-accent)] bg-surface ring-1 ring-inset ring-[var(--color-accent)]/40'
                      : 'border-divider bg-surface hover:border-[var(--color-accent)]/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-foreground">{CAT_LABEL[c] ?? c}</h3>
                    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-foreground-muted">
                      {countFor(c)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-foreground-muted">{CAT_DESC[c] ?? ''}</p>
                </button>
              );
            })}
          </div>

          {/* Selected category panel */}
          <div className="overflow-hidden rounded-xl border border-divider bg-surface">
            <div className="flex items-center justify-between border-b border-divider px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                {CAT_LABEL[selected] ?? selected} access{' '}
                {catGrants.length > 0 && <span className="text-foreground-dim">({catGrants.length})</span>}
              </h2>
              <button
                onClick={() => {
                  setAdding((v) => !v);
                  setSearch('');
                }}
                className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:bg-ink-hover"
              >
                {adding ? 'Close' : '+ Add role or user'}
              </button>
            </div>

            {/* Add picker */}
            {adding && (
              <div className="border-b border-divider bg-canvas px-4 py-3">
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search roles and users by name or email…"
                  className="mb-3 w-full rounded-md border border-divider-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-dim focus:border-[var(--color-accent)] focus:outline-none"
                />
                <div className="max-h-72 overflow-y-auto rounded-md border border-divider bg-surface">
                  {roleResults.length === 0 && userResults.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-foreground-dim">
                      {search ? 'No matching roles or users.' : 'Everyone is already added to this category.'}
                    </p>
                  ) : (
                    <>
                      {roleResults.length > 0 && (
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-dim">
                          Roles
                        </div>
                      )}
                      {roleResults.map((r) => (
                        <div
                          key={`role:${r.id}`}
                          className="flex items-center justify-between border-b border-divider px-3 py-2 last:border-0"
                        >
                          <span className="truncate text-sm font-medium text-foreground">{r.name}</span>
                          <button
                            onClick={() => pick('role', r.id)}
                            disabled={grant.isPending}
                            className="shrink-0 rounded-md border border-divider-strong bg-surface px-3 py-1 text-xs font-medium text-foreground transition hover:bg-canvas disabled:opacity-50"
                          >
                            Add
                          </button>
                        </div>
                      ))}
                      {userResults.length > 0 && (
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-dim">
                          Users
                        </div>
                      )}
                      {userResults.slice(0, 50).map((u) => (
                        <div
                          key={`user:${u.id}`}
                          className="flex items-center justify-between border-b border-divider px-3 py-2 last:border-0"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-foreground">{u.display_name || '—'}</span>
                              {u.user_type && u.user_type !== 'internal' && (
                                <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-500">
                                  {USER_TYPE_LABEL[u.user_type] ?? u.user_type}
                                </span>
                              )}
                            </div>
                            <div className="truncate text-xs text-foreground-muted">{u.email || u.id}</div>
                          </div>
                          <button
                            onClick={() => pick('user', u.id)}
                            disabled={grant.isPending}
                            className="shrink-0 rounded-md border border-divider-strong bg-surface px-3 py-1 text-xs font-medium text-foreground transition hover:bg-canvas disabled:opacity-50"
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                <p className="mt-2 text-xs text-foreground-dim">Added with View access — change the level on each row below.</p>
              </div>
            )}

            {/* Current grants */}
            {catGrants.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-foreground-muted">
                No one has access to {CAT_LABEL[selected] ?? selected} yet. Click{' '}
                <span className="font-medium text-foreground">+ Add role or user</span> to grant access.
              </p>
            ) : (
              <div>
                {roleGrants.length > 0 && (
                  <>
                    <div className="bg-canvas px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-dim">
                      Roles
                    </div>
                    {roleGrants.map((g) => (
                      <GrantRow key={`role:${g.subject_id}`} g={g} />
                    ))}
                  </>
                )}
                {userGrants.length > 0 && (
                  <>
                    <div className="bg-canvas px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-dim">
                      Users
                    </div>
                    {userGrants.map((g) => (
                      <GrantRow key={`user:${g.subject_id}`} g={g} />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
