'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobCard, JobCardQuestion } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

// Q&A moderation for one job card. Contract §7: answered ⇒ published (no
// separate flag — is_published is computed from answered_at). Admin delete is
// a proxy + tombstone both sides; the local tombstone survives event replays.
// Answering happens on the SquadHire business portal — this view is the
// admin's read + moderation surface.

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function JobCardQnA({ card }: { card: JobCard }) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<JobCardQuestion | null>(null);

  const { data: questionsRes, isLoading } = useQuery({
    queryKey: ['admin-job-card-questions', card.id],
    queryFn: () => api.get(`/admin/job-cards/${card.id}/questions`).then((r) => r.data),
  });
  const questions: JobCardQuestion[] = questionsRes?.data || [];

  // answered ⇒ published on the job profile (visible to every recipient);
  // unanswered = awaiting the business's reply.
  const { answered, unanswered } = useMemo(() => {
    const a: JobCardQuestion[] = [];
    const u: JobCardQuestion[] = [];
    for (const q of questions) (q.answered_at ? a : u).push(q);
    return { answered: a, unanswered: u };
  }, [questions]);

  const remove = useMutation({
    mutationFn: (questionId: string) => api.delete(`/admin/job-cards/${card.id}/questions/${questionId}`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin-job-card-questions', card.id] });
      setDeleting(null);
      showToast(
        res.data?.squadhire_notified === false
          ? 'Question deleted here — SquadHire could not be reached, it will reconcile.'
          : 'Question deleted on both sides.',
        'success',
      );
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to delete the question', 'error');
    },
  });

  const QuestionCard = ({ q }: { q: JobCardQuestion }) => (
    <div className="rounded-lg border border-divider bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-foreground">{q.question}</p>
          <p className="mt-1 text-[11px] text-foreground-dim">
            Asked by {q.talent_name || 'a candidate'} · {formatWhen(q.created_at)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDeleting(q)}
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50"
        >
          Delete
        </button>
      </div>
      {q.answer ? (
        <div className="mt-2 rounded-md bg-canvas px-3 py-2">
          <p className="text-sm text-foreground">{q.answer}</p>
          <p className="mt-1 text-[11px] text-foreground-dim">
            Answered by {q.answered_by_label || 'the business'}
            {q.answered_at ? ` · ${formatWhen(q.answered_at)}` : ''} · published on the job profile
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-foreground-dim">
          Awaiting the business&apos;s answer (answered questions publish automatically).
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {isLoading ? (
        <p className="py-6 text-center text-xs text-foreground-dim">Loading questions…</p>
      ) : questions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-divider px-4 py-8 text-center text-xs text-foreground-dim">
          No questions yet — candidates can ask on the job profile once the card is broadcast.
        </p>
      ) : (
        <>
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-dim">
              Unanswered ({unanswered.length})
            </h4>
            {unanswered.length === 0 ? (
              <p className="text-xs text-foreground-dim">Nothing waiting.</p>
            ) : (
              <div className="space-y-2">
                {unanswered.map((q) => (
                  <QuestionCard key={q.id} q={q} />
                ))}
              </div>
            )}
          </section>
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-dim">
              Answered & published ({answered.length})
            </h4>
            {answered.length === 0 ? (
              <p className="text-xs text-foreground-dim">No published Q&A yet.</p>
            ) : (
              <div className="space-y-2">
                {answered.map((q) => (
                  <QuestionCard key={q.id} q={q} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete this question?"
        description="It disappears from the job profile's Q&A for every candidate, on both SquadHub and SquadHire. This cannot be undone."
        confirmLabel="Delete question"
        variant="danger"
        isPending={remove.isPending}
        pendingLabel="Deleting…"
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
