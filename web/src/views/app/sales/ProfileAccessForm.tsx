'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import type { ProfileAccessGrant } from '@squadhub/shared';

interface SquadhireCategory {
  id: string;
  name: string;
  slug: string;
}

interface Props {
  basePath: string;          // '/profile-access' or '/admin/profile-access'
  grant: ProfileAccessGrant | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

function defaultExpiry(): string {
  // +5 days, end of day local — same default the Profiles admin form uses.
  const d = new Date();
  d.setDate(d.getDate() + 5);
  d.setHours(23, 59, 0, 0);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD for <input type="date">
}

function endOfDayIso(localDate: string): string {
  // localDate is YYYY-MM-DD; pin to 23:59:59.999 in UTC.
  const d = new Date(`${localDate}T23:59:59.999Z`);
  return d.toISOString();
}

export default function ProfileAccessForm({ basePath, grant, onClose, onSaved }: Props) {
  const isEdit = !!grant;

  const [email, setEmail] = useState(grant?.email ?? '');
  const [categoryIds, setCategoryIds] = useState<string[]>(grant?.category_ids ?? []);
  const [expiresOn, setExpiresOn] = useState<string>(
    grant?.expires_at ? grant.expires_at.slice(0, 10) : defaultExpiry(),
  );
  const [notes, setNotes] = useState<string>(grant?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  // Re-sync state if the editing target changes underneath us.
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
        return api.patch(`${basePath}/${grant!.id}`, payload).then((r) => r.data);
      } else {
        return api.post(basePath, payload).then((r) => r.data);
      }
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || err.message || 'Save failed');
    },
  });

  const canSubmit = useMemo(() => {
    if (categoryIds.length === 0) return false;
    if (!expiresOn) return false;
    if (!isEdit && !email.trim()) return false;
    return true;
  }, [categoryIds, expiresOn, isEdit, email]);

  function toggleCategory(id: string) {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-[var(--surface)] p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-[var(--sh-ink)]">
            {isEdit ? 'Edit Grant' : 'Create Grant'}
          </h2>
          <button onClick={onClose} className="text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)]">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isEdit}
              placeholder="grantee@example.com"
              className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--sh-ink-3)] disabled:bg-[var(--sh-hair-3)] disabled:text-[var(--sh-ink-4)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Categories</label>
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
                        on
                          ? 'bg-indigo-600 text-white'
                          : 'bg-[var(--sh-hair-3)] text-[var(--sh-ink-3)] hover:bg-indigo-50'
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
            <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Expires on</label>
            <input
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              className="rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--sh-ink-3)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--sh-ink-3)]">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Why this grant exists, follow-ups, etc."
              className="w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--sh-ink-3)]"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--sh-hair)] px-4 py-2 text-sm font-medium text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)]"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              setError(null);
              submitMutation.mutate();
            }}
            disabled={!canSubmit || submitMutation.isPending}
            className="rounded-md bg-[var(--sh-ink)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitMutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Create Grant'}
          </button>
        </div>
      </div>
    </div>
  );
}
