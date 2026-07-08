'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { JobCard } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Read-only "who would match" preview — runs the SquadHire matcher on the
// card's effective rules WITHOUT ingesting, creating recipients, or notifying
// anyone. Cached on job_cards.squadhire_match_preview; Refresh re-runs it.

export default function JobMatchPreview({ card }: { card: JobCard }) {
  const qc = useQueryClient();
  const preview = card.squadhire_match_preview;

  const refresh = useMutation({
    mutationFn: () => api.post(`/admin/job-cards/${card.id}/match-preview`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      const count = res.data?.data?.count;
      showToast(
        typeof count === 'number'
          ? `${count} matching talent${count === 1 ? '' : 's'} on SquadHire right now.`
          : 'Match preview refreshed.',
        'success',
      );
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to refresh the match preview', 'error');
    },
  });

  return (
    <div className="rounded-lg border border-divider bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Match preview</p>
          <p className="text-[11px] text-foreground-dim">
            Who would receive this card if broadcast now — read-only, nobody is notified.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || !card.job_profile_id}
          title={!card.job_profile_id ? 'Attach a job profile first' : undefined}
          className="shrink-0 rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50"
        >
          {refresh.isPending ? 'Refreshing…' : preview ? 'Refresh' : 'Preview matches'}
        </button>
      </div>

      {preview ? (
        <div className="mt-3">
          <p className="text-sm text-foreground">
            <span className="text-lg font-bold tabular-nums">{preview.count}</span>{' '}
            matching talent{preview.count === 1 ? '' : 's'}
            <span className="ml-2 text-[11px] text-foreground-dim">
              as of {new Date(preview.refreshed_at).toLocaleString()}
            </span>
          </p>
          {preview.talents?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {preview.talents.map((t) => (
                <span
                  key={t.talent_user_id}
                  className="rounded-full border border-divider bg-canvas px-2.5 py-0.5 text-xs text-foreground-muted"
                >
                  {t.talent_name || t.talent_user_id.slice(0, 8)}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-foreground-dim">No preview yet.</p>
      )}
    </div>
  );
}
