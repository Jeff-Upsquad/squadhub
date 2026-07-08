'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { JobCard, JobCardClosedReason } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Close dialog — ends the round with a reason. Contract §6 close semantics
// run on the Profiles side (withdraw un-accepted offers + notify the
// remaining offered candidates); POST /admin/job-cards/:id/close fires the
// jobs close webhook alongside the local state change.

const REASONS: { value: JobCardClosedReason; label: string; blurb: string }[] = [
  { value: 'filled', label: 'Filled', blurb: 'The openings are hired — a normal successful close.' },
  { value: 'cancelled', label: 'Cancelled', blurb: 'The client called the search off.' },
  { value: 'expired', label: 'Expired', blurb: 'The requirement lapsed without a hire.' },
];

export default function CloseJobCardDialog({
  card,
  onClose,
  onClosed,
}: {
  card: JobCard;
  onClose: () => void;
  onClosed?: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<JobCardClosedReason>('filled');

  const close = useMutation({
    mutationFn: () => api.post(`/admin/job-cards/${card.id}/close`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      showToast('Card closed — remaining offered candidates are notified by SquadHire.', 'success');
      onClosed?.();
      onClose();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to close the card', 'error');
    },
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-divider bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground">Close this job card?</h3>
        <p className="mt-1 text-xs text-foreground-muted">
          The round ends: un-accepted offers are withdrawn and the remaining offered candidates are notified.
          The card leaves the live pipeline.
        </p>

        <div className="mt-4 space-y-2">
          {REASONS.map((r) => (
            <label
              key={r.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                reason === r.value ? 'border-ink bg-sh-lime-soft/40' : 'border-divider hover:border-ink'
              }`}
            >
              <input
                type="radio"
                name="close-reason"
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-semibold text-foreground">{r.label}</span>
                <span className="mt-0.5 block text-xs text-foreground-muted">{r.blurb}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => close.mutate()}
            disabled={close.isPending}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {close.isPending ? 'Closing…' : 'Close card'}
          </button>
        </div>
      </div>
    </div>
  );
}
