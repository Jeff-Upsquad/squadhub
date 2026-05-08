'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import type { PublishedCard } from '@/views/admin/AdminPublishedCards';
import type { RecipientsResponse } from '@/views/admin/AdminPublishedCardRecipientsPanel';
import MobileActionSheet from './MobileActionSheet';
import MobileRecipientsList from './MobileRecipientsList';
import MobileAssignModal from './MobileAssignModal';

function formatFullDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function formatDeliverable(d: { kind: 'hours' | 'item'; per_day: number; per_week: number; per_month: number }): string {
  if (d.kind === 'hours') {
    if (d.per_week) return `${d.per_week} hrs/week`;
    if (d.per_day) return `${d.per_day} hrs/day`;
    if (d.per_month) return `${d.per_month} hrs/month`;
    return '—';
  }
  if (d.per_week) return `${d.per_week}× per week`;
  if (d.per_day) return `${d.per_day}× per day`;
  if (d.per_month) return `${d.per_month}× per month`;
  return '—';
}

export default function MobileCardDetail({
  card,
  onClose,
}: {
  card: PublishedCard;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [viewingSecondaryId, setViewingSecondaryId] = useState<string | null>(null);
  const [recallSheetOpen, setRecallSheetOpen] = useState(false);
  const [undoSheetOpen, setUndoSheetOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const { data: secondaryCards } = useQuery({
    queryKey: ['admin-secondary-cards', card.id],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${card.id}/secondary-cards`).then((r) => r.data?.data as PublishedCard[]),
    enabled: !card.parent_card_id,
  });

  const activeSecondary = useMemo(
    () => (secondaryCards || []).find((s) => s.id === viewingSecondaryId) || null,
    [secondaryCards, viewingSecondaryId],
  );
  const activeCard = activeSecondary || card;
  const activeCardId = activeCard.id;

  const { data: recipients, isLoading: recipientsLoading } = useQuery({
    queryKey: ['admin-card-recipients', activeCardId],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${activeCardId}/recipients`).then((r) => r.data?.data as RecipientsResponse),
  });

  // Mutations
  const recallCard = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${activeCardId}/recall`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      setRecallSheetOpen(false);
    },
  });

  const selectPartner = useMutation({
    mutationFn: (partnerId: string) =>
      api.post(`/admin/subscription-cards/${activeCardId}/select-partner`, { partner_id: partnerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
    },
  });

  const selectTalent = useMutation({
    mutationFn: (talentId: string) =>
      api.post(`/admin/subscription-cards/${activeCardId}/select-talent`, { talent_id: talentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
    },
  });

  const undoSelection = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${activeCardId}/undo-selection`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      setUndoSheetOpen(false);
    },
  });

  const removePartner = useMutation({
    mutationFn: (partnerId: string) =>
      api.delete(`/admin/subscription-cards/${activeCardId}/recipients/${partnerId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] }),
  });

  const removeTalent = useMutation({
    mutationFn: (talentId: string) =>
      api.delete(`/admin/subscription-cards/${activeCardId}/external-recipients/${talentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] }),
  });

  const hasSelection = activeCard.selected_recipient_type != null;
  const isActive = activeCard.state === 'published';
  const plan = card.submission_subscription?.plan;
  const planLabel = plan ? `${plan.plan} · ${plan.tier}` : '';
  const planPrice = plan?.pricing?.[0];
  const priceCurrency = planPrice?.country?.currency || card.submission?.country?.currency || '';
  const publisher = card.published_by_user;
  const business = card.submission?.business_name || card.customer_company || 'Unknown business';

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col bg-[#F7F6F3]" style={{ animation: 'slideUp 0.3s ease-out' }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-black bg-white px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            {viewingSecondaryId ? (
              <button
                onClick={() => setViewingSecondaryId(null)}
                className="shrink-0 rounded-lg border-2 border-black bg-white p-1.5 active:scale-[0.97] transition-transform"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            ) : null}
            <h3 className="truncate font-[family-name:var(--font-jakarta)] text-base font-bold text-[#0a0a0a]">
              {viewingSecondaryId ? 'Secondary Card' : business}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg border-2 border-black bg-white p-1.5 active:scale-[0.97] transition-transform"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto pb-28">
          {/* Card info section */}
          <div className="space-y-3 px-4 py-4">
            {/* Status badges */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-black/20 px-2.5 py-1 text-xs font-bold"
                style={{
                  backgroundColor: isActive ? '#10B98118' : '#6B728018',
                  color: isActive ? '#10B981' : '#6B7280',
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: isActive ? '#10B981' : '#6B7280' }} />
                {isActive ? 'Active' : 'Cancelled'}
              </span>
              <span className="rounded-full border border-black/20 bg-[#F7F6F3] px-2.5 py-1 text-xs font-bold text-[#525252]">
                {activeCard.distribution === 'manual' ? 'Published' : 'Broadcast'}
              </span>
            </div>

            {/* Business & plan info card */}
            <div className="rounded-2xl border-2 border-black bg-white p-4 shadow-[2px_2px_0_0_#000]">
              <p className="font-[family-name:var(--font-jakarta)] text-base font-bold text-[#0a0a0a]">{business}</p>
              {planLabel && <p className="mt-0.5 text-sm text-[#525252]">{planLabel}</p>}
              <p className="mt-1 text-xs text-[#a3a3a3]">
                Published {formatFullDateTime(activeCard.published_at || card.published_at)}
              </p>
              {publisher && (
                <p className="text-xs text-[#a3a3a3]">
                  by {publisher.display_name || publisher.email || publisher.id.slice(0, 8)}
                </p>
              )}
            </div>

            {/* Recalled notice */}
            {activeCard.recalled_at && (
              <div className="rounded-2xl border-2 border-[#F76808] bg-orange-50 px-4 py-3">
                <p className="text-sm font-bold text-orange-800">Recalled</p>
                <p className="mt-0.5 text-xs text-orange-700">
                  {formatFullDateTime(activeCard.recalled_at)} — Acceptees still see this card with a "Recalled" tag.
                </p>
              </div>
            )}

            {/* Working & business details */}
            {(card.working_days?.length > 0 || card.brand_name || card.business_nature) && (
              <DetailCard title="Working & Business" tint="#a8e8e8">
                {card.working_days?.length > 0 && (
                  <DetailRow label="Working days" value={card.working_days.join(' · ')} />
                )}
                {card.brand_name && <DetailRow label="Brand" value={card.brand_name} />}
                {card.business_nature && <DetailRow label="Nature" value={card.business_nature} />}
                {card.notes && <DetailRow label="Notes" value={card.notes} />}
              </DetailCard>
            )}

            {/* Targeting */}
            {(card.target_tiers?.length > 0 || card.min_experience_years > 0 || card.target_languages?.length > 0) && (
              <DetailCard title="Targeting" tint="#d4ff4d">
                {card.target_tiers?.length > 0 && (
                  <DetailRow label="Tiers" value={card.target_tiers.join(' · ')} />
                )}
                {card.min_experience_years > 0 && (
                  <DetailRow label="Min experience" value={`${card.min_experience_years}+ years`} />
                )}
                {card.target_languages?.length > 0 && (
                  <DetailRow label="Languages" value={card.target_languages.join(' · ')} />
                )}
              </DetailCard>
            )}

            {/* Deliverables */}
            {card.custom_deliverables?.length > 0 && (
              <DetailCard title="Deliverables" tint="#F7F6F3">
                {card.custom_deliverables.map((d) => (
                  <DetailRow key={d.id} label={d.name} value={formatDeliverable(d)} />
                ))}
              </DetailCard>
            )}

            {/* Pricing */}
            <DetailCard title="Pricing" tint="#F7F6F3">
              {planPrice && (
                <DetailRow label="Plan price" value={`${priceCurrency} ${planPrice.price.toLocaleString()}`} />
              )}
              {activeCard.partner_price_override != null ? (
                <DetailRow label="Partner price" value={`${priceCurrency} ${activeCard.partner_price_override.toLocaleString()}`} />
              ) : viewingSecondaryId ? (
                <DetailRow label="Partner price" value="Same as primary" />
              ) : card.partner_price_override != null ? (
                <DetailRow label="Partner override" value={`${priceCurrency} ${card.partner_price_override.toLocaleString()}`} />
              ) : null}
            </DetailCard>

            {/* Secondary cards */}
            {!viewingSecondaryId && !card.parent_card_id && (secondaryCards?.length ?? 0) > 0 && (
              <div className="rounded-2xl border-2 border-black bg-white p-4 shadow-[2px_2px_0_0_#000]">
                <h4 className="mb-3 font-[family-name:var(--font-jakarta)] text-xs font-bold uppercase tracking-wider text-[#a3a3a3]">
                  Secondary Cards ({secondaryCards?.length})
                </h4>
                <div className="space-y-2">
                  {(secondaryCards || []).map((sc) => {
                    const scActive = sc.state === 'published';
                    const scRecalled = !!sc.recalled_at;
                    const p = sc.recipient_counts?.partners ?? { pending: 0, accepted: 0, rejected: 0 };
                    const t = sc.recipient_counts?.talents ?? { accepted: 0, rejected: 0 };
                    return (
                      <button
                        key={sc.id}
                        onClick={() => setViewingSecondaryId(sc.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border-2 border-black/20 bg-[#F7F6F3] px-3 py-2.5 text-left active:bg-[#e5e5e5] transition-colors"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                              style={{
                                backgroundColor: scActive ? '#10B98118' : scRecalled ? '#F7680818' : '#6B728018',
                                color: scActive ? '#10B981' : scRecalled ? '#F76808' : '#6B7280',
                              }}
                            >
                              {scActive ? 'Active' : scRecalled ? 'Recalled' : 'Closed'}
                            </span>
                            <span className="text-[9px] font-semibold text-[#a3a3a3]">
                              {sc.distribution === 'manual' ? 'Published' : 'Broadcast'}
                            </span>
                          </div>
                          <p className="text-xs text-[#0a0a0a]">
                            {sc.partner_price_override != null
                              ? `${priceCurrency} ${sc.partner_price_override.toLocaleString()}`
                              : 'Same price'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold text-emerald-700">{p.accepted + t.accepted}✓</span>
                          <span className="text-[9px] font-bold text-red-600">{p.rejected + t.rejected}✗</span>
                          <svg className="h-3.5 w-3.5 text-[#a3a3a3]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recipients section */}
            <div className="rounded-2xl border-2 border-black bg-white p-4 shadow-[2px_2px_0_0_#000]">
              <h4 className="mb-3 font-[family-name:var(--font-jakarta)] text-xs font-bold uppercase tracking-wider text-[#a3a3a3]">
                Recipients
              </h4>
              {recipientsLoading ? (
                <p className="py-4 text-center text-xs text-[#a3a3a3] animate-pulse">Loading recipients...</p>
              ) : (
                <MobileRecipientsList
                  partners={recipients?.partners || []}
                  talents={recipients?.talents || []}
                  hasSelection={hasSelection}
                  isCardActive={isActive}
                  onSelectPartner={(id) => selectPartner.mutate(id)}
                  onSelectTalent={(id) => selectTalent.mutate(id)}
                  onRemovePartner={(id) => removePartner.mutate(id)}
                  onRemoveTalent={(id) => removeTalent.mutate(id)}
                  isSelecting={selectPartner.isPending || selectTalent.isPending}
                  isRemoving={removePartner.isPending || removeTalent.isPending}
                />
              )}
            </div>
          </div>
        </div>

        {/* Sticky action bar */}
        <div className="fixed bottom-0 left-0 right-0 z-[55] border-t-2 border-black bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex gap-2">
            {isActive && !hasSelection && (
              <>
                <button
                  onClick={() => setRecallSheetOpen(true)}
                  className="flex-1 rounded-xl border-2 border-black bg-[#F76808] px-4 py-3 text-sm font-bold text-white shadow-[2px_2px_0_0_#000] active:scale-[0.97] active:shadow-[1px_1px_0_0_#000] transition-transform"
                >
                  Recall
                </button>
                <button
                  onClick={() => setAssignOpen(true)}
                  className="flex-1 rounded-xl border-2 border-black bg-[#d4ff4d] px-4 py-3 text-sm font-bold text-black shadow-[2px_2px_0_0_#000] active:scale-[0.97] active:shadow-[1px_1px_0_0_#000] transition-transform"
                >
                  Assign
                </button>
              </>
            )}
            {hasSelection && (
              <button
                onClick={() => setUndoSheetOpen(true)}
                className="flex-1 rounded-xl border-2 border-black bg-white px-4 py-3 text-sm font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#000] active:scale-[0.97] active:shadow-[1px_1px_0_0_#000] transition-transform"
              >
                Undo Selection
              </button>
            )}
            {!isActive && !hasSelection && (
              <p className="flex-1 py-3 text-center text-sm text-[#a3a3a3]">This card is closed.</p>
            )}
          </div>
        </div>
      </div>

      {/* Recall confirmation */}
      <MobileActionSheet
        open={recallSheetOpen}
        onClose={() => setRecallSheetOpen(false)}
        title="Recall this card?"
        description="Pending recipients will stop seeing it. Acceptees keep the card with a 'Recalled' tag. This cannot be undone."
        actions={[
          {
            label: recallCard.isPending ? 'Recalling...' : 'Recall Card',
            variant: 'danger',
            disabled: recallCard.isPending,
            onPress: () => recallCard.mutate(),
          },
        ]}
      />

      {/* Undo selection confirmation */}
      <MobileActionSheet
        open={undoSheetOpen}
        onClose={() => setUndoSheetOpen(false)}
        title="Undo selection?"
        description="The card will reopen as published and the selected recipient will be deselected."
        actions={[
          {
            label: undoSelection.isPending ? 'Undoing...' : 'Undo Selection',
            variant: 'primary',
            disabled: undoSelection.isPending,
            onPress: () => undoSelection.mutate(),
          },
        ]}
      />

      {/* Assign modal */}
      {assignOpen && (
        <MobileAssignModal cardId={activeCardId} onClose={() => setAssignOpen(false)} />
      )}
    </>
  );
}

function DetailCard({ title, tint, children }: { title: string; tint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-black bg-white shadow-[2px_2px_0_0_#000] overflow-hidden">
      <div className="px-4 py-2" style={{ backgroundColor: `${tint}30` }}>
        <h4 className="font-[family-name:var(--font-jakarta)] text-xs font-bold uppercase tracking-wider text-[#525252]">
          {title}
        </h4>
      </div>
      <div className="space-y-2 px-4 py-3">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs text-[#a3a3a3]">{label}</span>
      <span className="text-right text-xs font-semibold text-[#0a0a0a]">{value}</span>
    </div>
  );
}
