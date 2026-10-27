'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RequirementReview } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
export default function RequirementReviewBar({ kind, cards }: {
    kind: 'subscription' | 'job';
    cards: Array<RequirementReview & {
        id: string;
    }>;
}) {
    const qc = useQueryClient();
    const pending = cards.filter(c => !c.requirement_reviewed_at);
    const refresh = () => {
        for (const key of ['admin-subscription-cards', 'admin-review-drafts', 'admin-card-editor', 'admin-job-cards', 'cards-attention', 'admin-card-events'])
            void qc.invalidateQueries({ queryKey: [key] });
    };
    const review = useMutation({
        mutationFn: () => Promise.all(pending.map(c => api.post(`/admin/cards/${kind}/${c.id}/mark-reviewed`))),
        onSuccess: () => { refresh(); showToast('Marked as reviewed', 'success'); },
        onError: (e: any) => { refresh(); showToast(e?.response?.data?.error ?? 'Review could not be saved', 'error'); },
    });
    return <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
    <div className="text-xs text-foreground-muted">
      {cards.some(c => c.auto_broadcast_status === 'pending') && <p>Automatic broadcast queued</p>}
      {cards.filter(c => c.auto_broadcast_status === 'retrying').map(c => <p key={`delivery-${c.id}`} role="status" className="text-amber-700">Automatic broadcast will retry: {c.auto_broadcast_error}</p>)}
      {pending.length > 0 && <p>New for Review · {pending.length} {pending.length === 1 ? 'card' : 'tiers'} awaiting review</p>}
      {cards.filter(c => c.requirement_reviewed_at).map(c => <p key={c.id}>Reviewed by {c.requirement_reviewer_name ?? c.requirement_reviewed_by ?? 'Admin'} · {new Date(c.requirement_reviewed_at!).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })}</p>)}
    </div>
    <button type="button" className="sh-btn-primary sh-btn-primary-sm" disabled={!pending.length || review.isPending} onClick={() => review.mutate()}>{review.isPending ? 'Saving…' : pending.length ? 'Mark as Reviewed' : 'Reviewed'}</button>
  </div>;
}
