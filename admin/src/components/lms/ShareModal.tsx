'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsAccessLevel, LmsItemShare, Role, User } from '@squadhub/shared';
import { LMS_SHARE_USER_TYPES, lmsUserTypeMeta } from '@squadhub/shared';

interface Props {
  itemId: string;
  itemTitle: string;
  onClose: () => void;
}

type Row = {
  principal_type: 'user' | 'role' | 'user_type';
  principal_id: string;
  access_level: LmsAccessLevel;
  label: string;
  sub?: string;
  color?: string;
};

const LEVELS: { value: LmsAccessLevel; label: string; hint: string }[] = [
  { value: 'admin', label: 'Admin', hint: 'Add, edit & update the content' },
  { value: 'contributor', label: 'Contributor', hint: 'Submit changes for an admin to approve' },
  { value: 'commenter', label: 'Commenter', hint: 'Comment on pages (staff-only)' },
  { value: 'viewer', label: 'View only', hint: 'Read the content' },
];

export default function ShareModal({ itemId, itemTitle, onClose }: Props) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'people' | 'roles' | 'user_types'>('people');

  // Seed local rows from the saved shares (once).
  useQuery({
    queryKey: ['lms-shares', itemId],
    queryFn: async () => {
      const res = await api.get(`/admin/lms/items/${itemId}/shares`).then((r) => r.data);
      const shares: LmsItemShare[] = res?.data || [];
      setRows(
        shares.map((s) => {
          if (s.principal_type === 'user_type') {
            const meta = lmsUserTypeMeta(s.user_type);
            return {
              principal_type: 'user_type' as const,
              principal_id: s.user_type || s.principal_id,
              access_level: s.access_level,
              label: meta?.label || s.user_type || 'User type',
              sub: 'User type',
              color: meta?.color,
            };
          }
          return {
            principal_type: s.principal_type,
            principal_id: s.principal_id,
            access_level: s.access_level,
            label: s.principal_type === 'user' ? (s.user?.display_name || s.user?.email || 'Unknown') : (s.role?.name || 'Role'),
            sub: s.principal_type === 'user' ? s.user?.email ?? undefined : 'Role',
            color: s.principal_type === 'role' ? s.role?.color ?? undefined : undefined,
          };
        }),
      );
      return shares;
    },
  });

  const { data: usersRes } = useQuery({
    queryKey: ['lms-user-search', q],
    queryFn: () => api.get(`/admin/lms/users/search?q=${encodeURIComponent(q)}`).then((r) => r.data),
    enabled: tab === 'people',
  });
  const users: User[] = usersRes?.data || [];

  const { data: rolesRes } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
    enabled: tab === 'roles',
  });
  const roles: Role[] = rolesRes?.data || [];

  const save = useMutation({
    mutationFn: () =>
      api.put(`/admin/lms/items/${itemId}/shares`, {
        shares: (rows || []).map((r) => ({ principal_type: r.principal_type, principal_id: r.principal_id, access_level: r.access_level })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lms-shares', itemId] });
      onClose();
    },
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed to save sharing'),
  });

  const takenIds = useMemo(() => new Set((rows || []).map((r) => `${r.principal_type}:${r.principal_id}`)), [rows]);

  function add(row: Row) {
    setRows((prev) => (prev || []).some((r) => r.principal_type === row.principal_type && r.principal_id === row.principal_id) ? prev : [...(prev || []), row]);
  }
  function setLevel(i: number, level: LmsAccessLevel) {
    setRows((prev) => (prev || []).map((r, idx) => (idx === i ? { ...r, access_level: level } : r)));
  }
  function remove(i: number) {
    setRows((prev) => (prev || []).filter((_, idx) => idx !== i));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !save.isPending && onClose()}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-divider bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-divider px-5 py-4">
          <h2 className="text-lg font-bold text-foreground">Share “{itemTitle}”</h2>
          <p className="mt-0.5 text-[12.5px] text-foreground-muted">
            Give people or roles access. This is separate from the learner <span className="font-medium">Audience</span> (who it&apos;s assigned to).
          </p>
        </div>

        {/* Add picker */}
        <div className="border-b border-divider px-5 py-3">
          <div className="mb-2 flex gap-1 rounded-lg bg-canvas p-1 text-[13px]">
            <button onClick={() => setTab('people')} className={`flex-1 rounded-md px-3 py-1 font-medium transition ${tab === 'people' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'}`}>People</button>
            <button onClick={() => setTab('roles')} className={`flex-1 rounded-md px-3 py-1 font-medium transition ${tab === 'roles' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'}`}>Roles</button>
            <button onClick={() => setTab('user_types')} className={`flex-1 rounded-md px-3 py-1 font-medium transition ${tab === 'user_types' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'}`}>User types</button>
          </div>

          {tab === 'people' ? (
            <>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search people by name or email"
                className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm placeholder-foreground-dim focus:border-ink focus:outline-none"
              />
              {q && (
                <ul className="mt-2 max-h-40 overflow-y-auto rounded-md border border-divider">
                  {users.filter((u) => !takenIds.has(`user:${u.id}`)).slice(0, 20).map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => add({ principal_type: 'user', principal_id: u.id, access_level: 'viewer', label: u.display_name || u.email, sub: u.email })}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-alt"
                      >
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-canvas text-[10px] font-semibold text-foreground-muted">
                          {(u.display_name || u.email || '?').slice(0, 2).toUpperCase()}
                        </span>
                        <span className="flex-1 truncate">
                          <span className="text-foreground">{u.display_name || u.email}</span>
                          <span className="ml-1.5 text-[11px] text-foreground-dim">{u.user_type}</span>
                        </span>
                        <span className="text-[11px] text-ink">+ Add</span>
                      </button>
                    </li>
                  ))}
                  {users.length === 0 && <li className="px-3 py-2 text-[12px] text-foreground-dim">No people found</li>}
                </ul>
              )}
            </>
          ) : tab === 'user_types' ? (
            <ul className="max-h-40 overflow-y-auto rounded-md border border-divider">
              {LMS_SHARE_USER_TYPES.filter((t) => !takenIds.has(`user_type:${t.value}`)).map((t) => (
                <li key={t.value}>
                  <button
                    type="button"
                    onClick={() => add({ principal_type: 'user_type', principal_id: t.value, access_level: 'viewer', label: t.label, sub: 'User type', color: t.color })}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-alt"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="flex-1 truncate">
                      <span className="text-foreground">{t.label}</span>
                      <span className="ml-1.5 text-[11px] text-foreground-dim">{t.description}</span>
                    </span>
                    <span className="text-[11px] text-ink">+ Add</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="max-h-40 overflow-y-auto rounded-md border border-divider">
              {roles.filter((r) => !takenIds.has(`role:${r.id}`)).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => add({ principal_type: 'role', principal_id: r.id, access_level: 'viewer', label: r.name, sub: 'Role', color: r.color })}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-alt"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                    <span className="flex-1 truncate text-foreground">{r.name}</span>
                    <span className="text-[11px] text-ink">+ Add</span>
                  </button>
                </li>
              ))}
              {roles.length === 0 && <li className="px-3 py-2 text-[12px] text-foreground-dim">No roles</li>}
            </ul>
          )}
        </div>

        {/* Current grants */}
        <div className="min-h-[4rem] flex-1 overflow-y-auto px-5 py-3">
          {rows === null ? (
            <p className="py-4 text-center text-[13px] text-foreground-dim">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-foreground-dim">Not shared with anyone yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((r, i) => (
                <li key={`${r.principal_type}:${r.principal_id}`} className="flex items-center gap-2 rounded-md border border-divider bg-surface px-2.5 py-1.5">
                  {r.principal_type === 'role' ? (
                    <span className="grid h-7 w-7 place-items-center rounded-full" style={{ backgroundColor: (r.color || '#6b7280') + '22' }}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color || '#6b7280' }} />
                    </span>
                  ) : r.principal_type === 'user_type' ? (
                    <span className="grid h-7 w-7 place-items-center rounded-full" style={{ backgroundColor: (r.color || '#6b7280') + '22' }}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color || '#6b7280' }} />
                    </span>
                  ) : (
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-canvas text-[10px] font-semibold text-foreground-muted">
                      {r.label.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="flex-1 truncate">
                    <span className="block truncate text-sm text-foreground">{r.label}</span>
                    {r.sub && <span className="block truncate text-[11px] text-foreground-dim">{r.sub}</span>}
                  </span>
                  <select
                    value={r.access_level}
                    onChange={(e) => setLevel(i, e.target.value as LmsAccessLevel)}
                    className="rounded-md border border-divider bg-surface px-2 py-1 text-[12.5px] text-foreground focus:border-ink focus:outline-none"
                  >
                    {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                  <button onClick={() => remove(i)} className="rounded p-1 text-foreground-dim hover:bg-canvas hover:text-red-600" title="Remove">×</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-divider px-5 py-3">
          <span className="text-[11px] text-foreground-dim">Roles cover their current & future members.</span>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={save.isPending} className="rounded-lg border border-divider bg-surface px-4 py-2 text-sm text-foreground-muted hover:bg-surface-alt disabled:opacity-50">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending || rows === null} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-hover disabled:opacity-50">
              {save.isPending ? 'Saving…' : 'Save sharing'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
