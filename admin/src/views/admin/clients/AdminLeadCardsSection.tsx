import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import type { AdminSubscriptionCard } from '../AdminSubscriptionCards';

type Props = {
  submissionId: string;
};

// Pill styling + label mirror the precedence-based `categorize()` in
// AdminSubscriptionCards so this drawer matches what the user sees on the detail
// page. A pinned `selected_recipient_id` means the card is "Assigned" even when
// state='closed' — the Profiles webhook closes the card and pins the selected
// talent together, so a state-only lookup would mislabel it as "Cancelled".
function pillFor(card: AdminSubscriptionCard): { bg: string; fg: string; label: string } {
  if (card.selected_recipient_id) return { bg: '#D1FAE5', fg: '#065F46', label: 'Assigned' };
  if (card.state === 'assigned') return { bg: '#E0F2FE', fg: '#075985', label: 'Selected' };
  if (card.state === 'closed') return { bg: '#EEF2F6', fg: '#475569', label: 'Cancelled' };
  if (card.state === 'published') return { bg: '#DCFCE7', fg: '#15803D', label: 'Published' };
  return { bg: '#F1F5F9', fg: '#475569', label: card.state };
}

function formatPublishedAt(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function AdminLeadCardsSection({ submissionId }: Props) {
  const { data: cardsRes, isLoading } = useQuery({
    queryKey: ['admin-submission-cards', submissionId],
    queryFn: () =>
      api
        .get('/admin/subscription-cards', { params: { submission_id: submissionId } })
        .then((r) => r.data),
    enabled: !!submissionId,
  });
  const cards: AdminSubscriptionCard[] = cardsRes?.data || [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Cards</h4>
        {cards.length > 0 && (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
            {cards.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="py-3 text-center text-xs text-foreground-dim">Loading…</p>
      ) : cards.length === 0 ? (
        <p className="py-3 text-center text-xs text-foreground-dim">No published cards yet.</p>
      ) : (
        <ul className="divide-y divide-[#F1F5F9] rounded-lg border border-divider bg-surface">
          {cards.map((card) => (
            <li key={card.id}>
              <a
                href={`/admin/subscription-cards?card=${card.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-alt transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <p className="font-medium text-foreground">
                      {card.submission_subscription?.subscription?.name
                        || card.plan_name
                        || card.service_type
                        || 'Card'}
                    </p>
                    {card.submission_subscription?.plan && (
                      <p className="text-xs text-foreground-muted">
                        {card.submission_subscription.plan.plan} · {card.submission_subscription.plan.tier}
                      </p>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {(() => {
                      const meta = pillFor(card);
                      return (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ backgroundColor: meta.bg, color: meta.fg }}
                        >
                          {meta.label}
                        </span>
                      );
                    })()}
                    {card.recalled_at && (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: '#FFE9D9', color: '#9A3412' }}
                      >
                        Recalled
                      </span>
                    )}
                    {card.published_at && (
                      <span className="text-[11px] text-foreground-dim">{formatPublishedAt(card.published_at)}</span>
                    )}
                  </div>
                </div>
                <svg
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-dim"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
