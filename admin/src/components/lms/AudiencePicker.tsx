'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import type { UserType, User } from '@squadhub/shared';

interface Props {
  userTypes: UserType[];
  userIds: string[];
  onChange: (next: { user_types: UserType[]; user_ids: string[] }) => void;
}

const ALL_USER_TYPES: { value: UserType; label: string; description: string }[] = [
  { value: 'internal', label: 'Internal team', description: 'All internal employees' },
  { value: 'client', label: 'Clients', description: 'Primary client contacts' },
  { value: 'client_staff', label: 'Client staff', description: 'Client team members' },
  { value: 'partner', label: 'Partners', description: 'External partners / contractors' },
  { value: 'partner_employee', label: 'Partner employees', description: 'Staff working under a partner' },
];

export default function AudiencePicker({ userTypes, userIds, onChange }: Props) {
  const [q, setQ] = useState('');

  const { data: searchRes } = useQuery({
    queryKey: ['lms-user-search', q],
    queryFn: () => api.get(`/admin/lms/users/search?q=${encodeURIComponent(q)}`).then((r) => r.data),
  });
  const users: User[] = searchRes?.data || [];

  const { data: selectedRes } = useQuery({
    queryKey: ['lms-user-ids', userIds.join(',')],
    queryFn: () => {
      if (!userIds.length) return Promise.resolve({ data: [] });
      return api.get(`/admin/lms/users/search?q=`).then((r) => r.data);
    },
    enabled: userIds.length > 0,
  });

  const selectedUsers: User[] = (selectedRes?.data || []).filter((u: User) => userIds.includes(u.id));

  function toggleType(t: UserType) {
    const next = userTypes.includes(t) ? userTypes.filter((x) => x !== t) : [...userTypes, t];
    onChange({ user_types: next, user_ids: userIds });
  }

  function addUser(id: string) {
    if (userIds.includes(id)) return;
    onChange({ user_types: userTypes, user_ids: [...userIds, id] });
  }

  function removeUser(id: string) {
    onChange({ user_types: userTypes, user_ids: userIds.filter((x) => x !== id) });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">By user type</label>
        <div className="space-y-1.5">
          {ALL_USER_TYPES.map((t) => {
            const checked = userTypes.includes(t.value);
            return (
              <label key={t.value} className="flex cursor-pointer items-start gap-2 rounded-md border border-divider bg-surface p-2.5 hover:border-divider-strong">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleType(t.value)}
                  className="mt-0.5 h-4 w-4 rounded border-divider-strong"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{t.label}</p>
                  <p className="text-[11px] text-foreground-muted">{t.description}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Specific users</label>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or email"
          className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm placeholder-foreground-dim focus:border-ink focus:outline-none"
        />
        {q && (
          <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border border-divider bg-surface">
            {users.filter((u) => !userIds.includes(u.id)).slice(0, 20).map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => addUser(u.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-alt"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-canvas text-[10px] font-semibold text-foreground-muted">
                    {(u.display_name || u.email || '?').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate">
                    <span className="text-foreground">{u.display_name || u.email}</span>
                    <span className="ml-1.5 text-[11px] text-foreground-dim">{u.user_type}</span>
                  </span>
                </button>
              </li>
            ))}
            {users.length === 0 && <li className="px-3 py-2 text-[12px] text-foreground-dim">No users</li>}
          </ul>
        )}

        {selectedUsers.length > 0 && (
          <div className="mt-2 space-y-1">
            {selectedUsers.map((u) => (
              <div key={u.id} className="flex items-center gap-2 rounded-md border border-divider bg-surface px-2.5 py-1.5 text-sm">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-canvas text-[10px] font-semibold text-foreground-muted">
                  {(u.display_name || u.email || '?').slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 truncate text-foreground">{u.display_name || u.email}</span>
                <button
                  type="button"
                  onClick={() => removeUser(u.id)}
                  className="rounded p-1 text-foreground-dim hover:bg-canvas hover:text-foreground"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
