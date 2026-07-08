'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { JobCard, JobCardCandidate } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Hire popup — contract §6: Profiles is canonical. keep_open=false closes the
// card THERE (withdrawing un-accepted offers + notifying the remaining offered
// candidates) and the job_card_closed echo syncs our state='closed'.

export default function HireDialog({
  card,
  candidate,
  onClose,
}: {
  card: JobCard;
  candidate: JobCardCandidate;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [joiningDate, setJoiningDate] = useState(candidate.joining_date ?? card.expected_joining_date ?? '');

  const hire = useMutation({
    mutationFn: (keepOpen: boolean) =>
      api.post(`/admin/job-cards/${card.id}/candidates/${candidate.external_candidate_id}/hire`, {
        keep_open: keepOpen,
        joining_date: joiningDate || undefined,
      }),
    onSuccess: (_res, keepOpen) => {
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-job-card-candidates', card.id] });
      showToast(
        keepOpen
          ? `${candidate.talent_name || 'Candidate'} hired — the card stays open for more hires.`
          : `${candidate.talent_name || 'Candidate'} hired — the card is closing; remaining offered candidates will be notified.`,
        'success',
      );
      onClose();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to hire the candidate', 'error');
    },
  });

  const hiredSoFar = card.hired_count ?? 0;
  const openings = card.openings_count ?? 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-divider bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground">
          Hire {candidate.talent_name || 'this candidate'}?
        </h3>
        <p className="mt-1 text-xs text-foreground-muted">
          {hiredSoFar + 1} of {openings} opening{openings === 1 ? '' : 's'} would be filled. Keep the card open
          for more hires, or close it — closing notifies the remaining offered candidates.
        </p>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-foreground">Joining date</label>
          <input
            type="date"
            value={joiningDate}
            onChange={(e) => setJoiningDate(e.target.value)}
            className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-foreground-dim">
            The candidate is notified with this date; on joining day the business marks them joined → Placed.
          </p>
        </div>

        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => hire.mutate(true)}
            disabled={hire.isPending}
            className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {hire.isPending ? 'Hiring…' : 'Hire & keep the card open'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  'Hire and CLOSE the card?\n\nUn-accepted offers are withdrawn and the remaining offered candidates are notified. This ends the round.',
                )
              ) {
                hire.mutate(false);
              }
            }}
            disabled={hire.isPending}
            className="w-full rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
          >
            Hire & close the card
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-md px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
