'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { UserLite, displayName, fmtDate } from './shared';

type TeamMember = { id: string; user_id: string; added_by: string | null; created_at: string; user: UserLite | null };

function Avatar({ user, size = 'h-7 w-7' }: { user: UserLite | null; size?: string }) {
  if (user?.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatar_url} alt="" className={`${size} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-xs font-semibold text-accent`}>
      {displayName(user).charAt(0).toUpperCase()}
    </span>
  );
}

export default function TeamTab() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounce the candidate search.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Close the combobox on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const { data: teamRes, isLoading } = useQuery({
    queryKey: ['admin-sales-team'],
    queryFn: () => api.get('/admin/sales-dashboard/team').then((r) => r.data),
  });
  const members: TeamMember[] = teamRes?.data || [];

  const { data: candidatesRes, isFetching: candidatesLoading } = useQuery({
    queryKey: ['admin-sales-team-candidates', debouncedQ],
    queryFn: () =>
      api
        .get(`/admin/sales-dashboard/team/candidates?q=${encodeURIComponent(debouncedQ)}`)
        .then((r) => r.data),
    enabled: open,
  });
  const candidates: UserLite[] = candidatesRes?.data || [];

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['admin-sales-team'] });
    queryClient.invalidateQueries({ queryKey: ['admin-sales-team-candidates'] });
    queryClient.invalidateQueries({ queryKey: ['admin-sales-summary'] });
    queryClient.invalidateQueries({ queryKey: ['admin-sales-targets'] });
  }

  const addMutation = useMutation({
    mutationFn: (user_id: string) => api.post('/admin/sales-dashboard/team', { user_id }),
    onSuccess: () => {
      setError(null);
      setQ('');
      setOpen(false);
      invalidateAll();
    },
    onError: (err: any) => setError(err?.response?.data?.error || 'Failed to add member'),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/sales-dashboard/team/${userId}`),
    onSuccess: () => {
      setError(null);
      invalidateAll();
    },
    onError: (err: any) => setError(err?.response?.data?.error || 'Failed to remove member'),
  });

  return (
    <div>
      {/* Add-member combobox */}
      <div ref={boxRef} className="relative mb-4 max-w-sm">
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Add a member — search internal users…"
          className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-xs text-foreground placeholder:text-foreground-dim"
        />
        {open && (
          <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-divider bg-surface shadow-lg">
            {candidatesLoading ? (
              <p className="px-3 py-2 text-xs text-foreground-dim">Searching…</p>
            ) : candidates.length === 0 ? (
              <p className="px-3 py-2 text-xs text-foreground-dim">
                {debouncedQ ? 'No matching internal users.' : 'No internal users available.'}
              </p>
            ) : (
              candidates.map((u) => (
                <button
                  key={u.id}
                  onClick={() => addMutation.mutate(u.id)}
                  disabled={addMutation.isPending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-alt disabled:opacity-50"
                >
                  <Avatar user={u} size="h-6 w-6" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {displayName(u)}
                    </span>
                    {u.email && (
                      <span className="block truncate text-[11px] text-foreground-muted">{u.email}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* Roster */}
      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
        {isLoading ? (
          <p className="py-12 text-center text-sm text-foreground-dim">Loading…</p>
        ) : members.length === 0 ? (
          <p className="py-12 text-center text-sm text-foreground-dim">
            No one is on the sales team yet — search above to add the first member.
          </p>
        ) : (
          <ul>
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 border-b border-divider px-4 py-2.5 last:border-b-0"
              >
                <Avatar user={m.user} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{displayName(m.user)}</p>
                  {m.user?.email && (
                    <p className="truncate text-[11px] text-foreground-muted">{m.user.email}</p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-foreground-dim">
                  Added {fmtDate(m.created_at)}
                </span>
                <button
                  onClick={() => removeMutation.mutate(m.user_id)}
                  disabled={removeMutation.isPending}
                  className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
