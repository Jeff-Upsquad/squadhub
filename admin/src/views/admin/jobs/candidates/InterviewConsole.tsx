'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { JobCard, JobInterview, JobInterviewOutcome } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Interview rounds timeline for one candidate — the admin mirror of the
// Profiles day console. Actions proxy to SquadHire (canonical) via
// POST /admin/job-cards/:id/interview-actions and /interviews/:inviteId/outcome;
// the echo event updates the local mirror rendered here.
//
// "Start" reveals the meeting link to THAT candidate only (+push) — the
// reveal gating lives on the Profiles side.

const STATUS_PILL: Record<string, { bg: string; color: string; label: string }> = {
  proposed: { bg: '#FEF3C7', color: '#92400E', label: 'Proposed' },
  scheduled: { bg: '#DBEAFE', color: '#1E40AF', label: 'Scheduled' },
  completed: { bg: '#D1FAE5', color: '#065F46', label: 'Completed' },
  cancelled: { bg: '#EEF2F6', color: '#475569', label: 'Cancelled' },
  no_show: { bg: '#FEE2E2', color: '#B91C1C', label: 'No-show' },
};

const OUTCOME_PILL: Record<JobInterviewOutcome, { bg: string; color: string; label: string }> = {
  selected: { bg: '#D1FAE5', color: '#065F46', label: 'Selected' },
  rejected: { bg: '#FEE2E2', color: '#B91C1C', label: 'Rejected' },
  on_hold: { bg: '#FEF3C7', color: '#92400E', label: 'On hold' },
};

function formatWhen(iso: string | null): string {
  if (!iso) return 'Not scheduled';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function InterviewConsole({
  card,
  interviews,
}: {
  card: JobCard;
  interviews: JobInterview[];
}) {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-job-card-candidates', card.id] });
    qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
  };

  const action = useMutation({
    mutationFn: ({ act, inviteId }: { act: 'showed_up' | 'start' | 'no_show' | 'not_joined'; inviteId: string }) =>
      api.post(`/admin/job-cards/${card.id}/interview-actions`, { action: act, invite_id: inviteId }),
    onSuccess: (_res, vars) => {
      invalidate();
      showToast(
        vars.act === 'start'
          ? 'Interview started — the meeting link is now revealed to this candidate.'
          : vars.act === 'showed_up'
            ? 'Marked as showed up.'
            : 'Marked absent — the next waitlisted candidate is promoted and notified.',
        'success',
      );
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Interview action failed', 'error');
    },
  });

  const outcome = useMutation({
    mutationFn: ({ inviteId, value }: { inviteId: string; value: JobInterviewOutcome }) =>
      api.post(`/admin/job-cards/${card.id}/interviews/${inviteId}/outcome`, { outcome: value }),
    onSuccess: (_res, vars) => {
      invalidate();
      showToast(`Outcome recorded: ${OUTCOME_PILL[vars.value].label}.`, 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to record the outcome', 'error');
    },
  });

  if (interviews.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-divider px-3 py-3 text-center text-xs text-foreground-dim">
        No interview rounds yet — shortlist the candidate and send a call for interview.
      </p>
    );
  }

  const ordered = [...interviews].sort((a, b) => a.round_number - b.round_number);

  return (
    <ol className="space-y-2">
      {ordered.map((iv) => {
        const pill = STATUS_PILL[iv.status] ?? { bg: '#EEF2F6', color: '#475569', label: iv.status };
        const live = iv.status === 'proposed' || iv.status === 'scheduled';
        const busy = action.isPending || outcome.isPending;
        return (
          <li key={iv.id} className="rounded-lg border border-divider bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Round {iv.round_number}
                  {iv.round_label ? ` · ${iv.round_label}` : ''}
                </p>
                <p className="mt-0.5 text-xs text-foreground-muted">
                  {iv.mode === 'virtual' ? 'Virtual' : 'Physical'} · {formatWhen(iv.scheduled_at)}
                  {iv.duration_minutes ? ` · ${iv.duration_minutes} min` : ''}
                </p>
                {iv.mode === 'physical' && iv.location_snapshot && (
                  <p className="mt-0.5 text-[11px] text-foreground-dim">
                    {[iv.location_snapshot.label, iv.location_snapshot.address, iv.location_snapshot.city]
                      .filter(Boolean)
                      .join(', ')}
                    {iv.location_snapshot.google_maps_url && (
                      <>
                        {' · '}
                        <a href={iv.location_snapshot.google_maps_url} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
                          Maps ↗
                        </a>
                      </>
                    )}
                  </p>
                )}
                {iv.mode === 'virtual' && iv.meeting_link && (
                  <p className="mt-0.5 text-[11px] text-foreground-dim">
                    Link:{' '}
                    <a href={iv.meeting_link} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
                      {iv.meeting_link}
                    </a>{' '}
                    {iv.meeting_link_revealed_at
                      ? `· revealed ${formatWhen(iv.meeting_link_revealed_at)}`
                      : '· locked for the candidate until Start'}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: pill.bg, color: pill.color }}>
                  {pill.label}
                </span>
                {iv.outcome && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: OUTCOME_PILL[iv.outcome].bg, color: OUTCOME_PILL[iv.outcome].color }}
                  >
                    {OUTCOME_PILL[iv.outcome].label}
                  </span>
                )}
              </div>
            </div>

            {live && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-divider pt-2.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action.mutate({ act: 'showed_up', inviteId: iv.external_interview_id })}
                  className="rounded-md border border-divider px-2.5 py-1 text-[11px] font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50"
                >
                  Showed up
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action.mutate({ act: 'start', inviteId: iv.external_interview_id })}
                  title="Reveals the meeting link to this candidate only and notifies them"
                  className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  Start interview
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action.mutate({ act: 'no_show', inviteId: iv.external_interview_id })}
                  className="rounded-md border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  No-show
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action.mutate({ act: 'not_joined', inviteId: iv.external_interview_id })}
                  title="Showed up / confirmed but never joined the meeting"
                  className="rounded-md border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  Didn&apos;t join
                </button>
                <span className="mx-1 h-4 w-px bg-divider" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-dim">Outcome:</span>
                {(Object.keys(OUTCOME_PILL) as JobInterviewOutcome[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={busy}
                    onClick={() => outcome.mutate({ inviteId: iv.external_interview_id, value: v })}
                    className="rounded-md border border-divider px-2.5 py-1 text-[11px] font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50"
                  >
                    {OUTCOME_PILL[v].label}
                  </button>
                ))}
              </div>
            )}
            {iv.outcome_notes && (
              <p className="mt-2 text-[11px] text-foreground-dim">Notes: {iv.outcome_notes}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
