import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import PublishedCardRecipientsPanel from '../sales/PublishedCardRecipientsPanel';

interface PublishedCard {
  id: string;
  state: 'published';
  published_at: string | null;
  brand_name: string | null;
  business_nature: string | null;
  notes: string | null;
  submission: {
    id: string;
    business_name: string;
    country: { id: string; name: string; currency: string } | null;
  } | null;
  submission_subscription: {
    id: string;
    subscription: { id: string; name: string } | null;
    plan: { id: string; plan: string; tier: string } | null;
  } | null;
  recipient_counts: {
    partners: { pending: number; accepted: number; rejected: number };
    talents: { accepted: number; rejected: number };
  };
}

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ClientPublishedCards() {
  const [openCard, setOpenCard] = useState<PublishedCard | null>(null);

  const { data: res, isLoading, error } = useQuery({
    queryKey: ['my-published-cards'],
    queryFn: () => api.get('/users/me/published-cards').then((r) => r.data),
  });

  const cards: PublishedCard[] = res?.data || [];

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
          Published Cards
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Subscription opportunities published for your business.
        </p>

        <div className="mt-6">
          {isLoading ? (
            <p className="text-sm text-foreground-muted">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-500">Failed to load published cards.</p>
          ) : cards.length === 0 ? (
            <div className="rounded-lg border border-divider bg-surface-alt p-8 text-center">
              <p className="text-sm text-foreground-muted">
                No published cards yet. They'll appear here once sales publishes one for you.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {cards.map((c) => {
                const subName = c.submission_subscription?.subscription?.name || 'Subscription';
                const planLabel = c.submission_subscription?.plan
                  ? `${c.submission_subscription.plan.plan} · ${c.submission_subscription.plan.tier}`
                  : null;
                const partners = c.recipient_counts.partners;
                const talents = c.recipient_counts.talents;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setOpenCard(c)}
                      className="block w-full rounded-lg border border-divider bg-surface-alt p-4 text-left transition hover:border-foreground/20 hover:bg-surface-alt/80"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate font-medium text-foreground">{subName}</h3>
                            {planLabel && (
                              <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                                {planLabel}
                              </span>
                            )}
                          </div>
                          {c.brand_name && (
                            <p className="mt-1 truncate text-sm text-foreground-muted">{c.brand_name}</p>
                          )}
                          {c.business_nature && (
                            <p className="mt-0.5 truncate text-xs text-foreground-muted">{c.business_nature}</p>
                          )}
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                          Published
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-muted">
                        <span>Published {formatRelative(c.published_at)}</span>
                        <span>·</span>
                        <span>
                          {partners.accepted} partner{partners.accepted === 1 ? '' : 's'} accepted
                          {partners.pending > 0 && ` · ${partners.pending} pending`}
                        </span>
                        {talents.accepted > 0 && (
                          <>
                            <span>·</span>
                            <span>
                              {talents.accepted} talent{talents.accepted === 1 ? '' : 's'} accepted
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {openCard && (
        <PublishedCardRecipientsPanel
          cardId={openCard.id}
          title={`${openCard.submission?.business_name || 'Business'} · ${openCard.submission_subscription?.subscription?.name || 'Subscription'}`}
          onClose={() => setOpenCard(null)}
          endpoint={`/users/me/published-cards/${openCard.id}/recipients`}
        />
      )}
    </div>
  );
}
