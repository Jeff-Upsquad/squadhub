'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsReviewSubmission } from '@squadhub/shared';

export default function AdminLmsReviewQueue() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: res, isLoading } = useQuery({
    queryKey: ['lms-review-queue'],
    queryFn: () => api.get('/admin/lms/review-queue').then((r) => r.data),
  });
  const items: LmsReviewSubmission[] = res?.data || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['lms-review-queue'] });
    qc.invalidateQueries({ queryKey: ['lms-items'] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/admin/lms/items/${id}/approve`),
    onSuccess: invalidate,
    onError: (e: any) => alert(e?.response?.data?.error || 'Approve failed'),
    onSettled: () => setBusyId(null),
  });
  const requestChanges = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.post(`/admin/lms/items/${id}/request-changes`, { note }),
    onSuccess: invalidate,
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed'),
    onSettled: () => setBusyId(null),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/admin/lms/items/${id}/reject`),
    onSuccess: invalidate,
    onError: (e: any) => alert(e?.response?.data?.error || 'Reject failed'),
    onSettled: () => setBusyId(null),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Review queue</h1>
          <p className="mt-1 text-sm text-foreground-muted">Contributor submissions awaiting your approval.</p>
        </div>
        <Link href="/admin/learning" className="rounded-lg border border-divider bg-surface px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-alt">
          ← Library
        </Link>
      </div>

      {isLoading ? (
        <p className="p-8 text-sm text-foreground-dim">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-divider-strong bg-surface p-10 text-center">
          <p className="text-sm text-foreground-muted">Nothing to review.</p>
          <p className="mt-1 text-[12px] text-foreground-dim">Contributor submissions will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => {
            const busy = busyId === s.id;
            const isNew = !s.origin_item_id;
            return (
              <li key={s.id} className="rounded-xl border border-divider bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">{s.title}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${isNew ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {isNew ? 'New content' : 'Edit to published'}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-foreground-muted">
                      {s.submitter?.display_name || s.submitter?.email || 'Someone'} · submitted{' '}
                      {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '—'}
                    </p>
                    {!isNew && s.origin && (
                      <p className="mt-0.5 text-[11px] text-foreground-dim">
                        Proposes changes to <span className="text-foreground-muted">{s.origin.title}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={`/admin/learning/${s.id}`}
                      className="rounded-lg border border-divider bg-surface px-3 py-1.5 text-[13px] text-foreground-muted hover:bg-surface-alt"
                    >
                      Open draft
                    </Link>
                    <button
                      onClick={() => { const note = prompt('What needs changing? (optional)') ?? ''; setBusyId(s.id); requestChanges.mutate({ id: s.id, note }); }}
                      disabled={busy}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[13px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      Request changes
                    </button>
                    <button
                      onClick={() => { if (confirm('Reject this submission?')) { setBusyId(s.id); reject.mutate(s.id); } }}
                      disabled={busy}
                      className="rounded-lg border border-divider bg-surface px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => { setBusyId(s.id); approve.mutate(s.id); }}
                      disabled={busy}
                      className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-white hover:bg-ink-hover disabled:opacity-50"
                    >
                      {busy && approve.isPending ? 'Approving…' : 'Approve'}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
