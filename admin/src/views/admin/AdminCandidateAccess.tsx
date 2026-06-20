'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { Role, User } from '@squadhub/shared';

interface AccessData {
  categories: string[];
  roles: Pick<Role, 'id' | 'name'>[];
  users: Pick<User, 'id' | 'email' | 'display_name'>[];
  roleGrants: Record<string, string[]>;
  userGrants: Record<string, string[]>;
}

const CAT_LABEL: Record<string, string> = { creative: 'Creative', accountant: 'Accountant', sales: 'Sales' };

export default function AdminCandidateAccess() {
  const queryClient = useQueryClient();
  const [userSearch, setUserSearch] = useState('');

  const { data, isLoading } = useQuery<AccessData>({
    queryKey: ['admin-candidate-access'],
    queryFn: async () => (await api.get('/admin/candidate-access')).data.data,
  });

  const mutation = useMutation({
    mutationFn: ({ kind, id, categories }: { kind: 'role' | 'user'; id: string; categories: string[] }) =>
      api.put(`/admin/candidate-access/${kind}/${id}`, { categories }).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-candidate-access'] }),
  });

  const toggle = (kind: 'role' | 'user', id: string, current: string[], category: string, checked: boolean) => {
    const next = checked ? [...current, category] : current.filter((c) => c !== category);
    mutation.mutate({ kind, id, categories: next });
  };

  const categories = data?.categories ?? ['creative', 'accountant', 'sales'];

  function Matrix({
    kind,
    rows,
    grants,
  }: {
    kind: 'role' | 'user';
    rows: { id: string; label: string; sub?: string }[];
    grants: Record<string, string[]>;
  }) {
    return (
      <div className="overflow-hidden rounded-xl border border-divider bg-surface">
        <table className="min-w-full divide-y divide-divider">
          <thead className="bg-canvas">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-foreground-muted">{kind === 'role' ? 'Role' : 'User'}</th>
              {categories.map((c) => (
                <th key={c} className="px-4 py-3 text-center text-xs font-medium uppercase text-foreground-muted">{CAT_LABEL[c] ?? c}</th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-foreground-muted">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {rows.length === 0 ? (
              <tr><td colSpan={categories.length + 2} className="px-4 py-6 text-center text-sm text-foreground-dim">None found.</td></tr>
            ) : (
              rows.map((row) => {
                const current = grants[row.id] ?? [];
                const restricted = current.length > 0;
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-foreground">{row.label}</div>
                      {row.sub && <div className="text-xs text-foreground-dim">{row.sub}</div>}
                    </td>
                    {categories.map((c) => (
                      <td key={c} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={current.includes(c)}
                          disabled={mutation.isPending}
                          onChange={(e) => toggle(kind, row.id, current, c, e.target.checked)}
                          className="h-4 w-4 cursor-pointer rounded border-divider accent-[var(--color-accent)]"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <span className={`text-xs ${restricted ? 'text-amber-600' : 'text-foreground-dim'}`}>
                        {restricted ? `Limited to ${current.map((c) => CAT_LABEL[c] ?? c).join(', ')}` : 'All categories'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    );
  }

  const users = (data?.users ?? []).filter((u) => {
    if (!userSearch) return true;
    const q = userSearch.toLowerCase();
    return (u.display_name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Candidate Access</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Control which candidate categories (Creative / Accountant / Sales) each role or user can see in the Candidates app.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-divider bg-canvas px-4 py-3 text-sm text-foreground-muted">
        <span className="font-medium text-foreground">How it works:</span> a role or user with{' '}
        <span className="font-medium">no boxes checked</span> has <span className="font-medium">full access</span> (all
        categories). Check categories to <span className="font-medium">limit</span> them to only those. A user is allowed a
        category if it&apos;s granted to them directly <span className="italic">or</span> via any of their roles. This only
        applies to people who already have the Candidates app.
      </div>

      {isLoading || !data ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">By role</h2>
            <Matrix kind="role" rows={(data.roles ?? []).map((r) => ({ id: r.id, label: r.name }))} grants={data.roleGrants} />
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">By user</h2>
              <input
                placeholder="Search users…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-64 rounded-lg border border-divider bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-dim focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
            <Matrix
              kind="user"
              rows={users.map((u) => ({ id: u.id, label: u.display_name || u.email || u.id, sub: u.email ?? undefined }))}
              grants={data.userGrants}
            />
          </section>
        </div>
      )}
    </div>
  );
}
