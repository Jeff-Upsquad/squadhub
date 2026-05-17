'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { squadhireDeliveryState, type PublishedCard } from '@/views/admin/AdminPublishedCards';
import type { RecipientsResponse } from '@/views/admin/AdminPublishedCardRecipientsPanel';
import MobileActionSheet from './MobileActionSheet';
import MobileRecipientsList from './MobileRecipientsList';
import MobileAssignModal from './MobileAssignModal';

type Country = { id: string; name: string; currency: string };

const EMPTY = '—';

function formatFullDateTime(iso: string | null): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function formatDeliverable(d: { kind: 'hours' | 'item'; per_day: number; per_week: number; per_month: number }): string {
  if (d.kind === 'hours') {
    if (d.per_week) return `${d.per_week} hrs/week`;
    if (d.per_day) return `${d.per_day} hrs/day`;
    if (d.per_month) return `${d.per_month} hrs/month`;
    return EMPTY;
  }
  if (d.per_week) return `${d.per_week}× per week`;
  if (d.per_day) return `${d.per_day}× per day`;
  if (d.per_month) return `${d.per_month}× per month`;
  return EMPTY;
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
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [recallSheetOpen, setRecallSheetOpen] = useState(false);
  const [cancelSheetOpen, setCancelSheetOpen] = useState(false);
  const [archiveSheetOpen, setArchiveSheetOpen] = useState(false);
  const [republishSheetOpen, setRepublishSheetOpen] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [broadcastSheetOpen, setBroadcastSheetOpen] = useState(false);
  const [undoSheetOpen, setUndoSheetOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [autoAcceptTarget, setAutoAcceptTarget] = useState<{ id: string; name: string; email: string } | null>(null);
  const [createSecondaryOpen, setCreateSecondaryOpen] = useState(false);
  const [secondaryPrice, setSecondaryPrice] = useState('');
  const [secondaryDistribution, setSecondaryDistribution] = useState<'manual' | 'broadcast'>('manual');

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

  const { data: countriesRes } = useQuery({
    queryKey: ['public-countries'],
    queryFn: () => api.get('/clients/countries').then((r) => r.data),
  });
  const countries: Country[] = countriesRes?.data || [];

  const { data: squadhireCategoriesRes } = useQuery({
    queryKey: ['squadhire-categories'],
    queryFn: () => api.get('/admin/integrations/squadhire/categories').then((r) => r.data?.data || []),
    staleTime: 10 * 60 * 1000,
  });
  const squadhireCategories: Array<{ id: string; name: string }> = squadhireCategoriesRes || [];

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
    qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
    qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
  };

  const recallCard = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${activeCardId}/recall`),
    onSuccess: () => { invalidateAll(); setRecallSheetOpen(false); },
  });

  const cancelCard = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${activeCardId}/cancel`),
    onSuccess: () => { invalidateAll(); setCancelSheetOpen(false); },
  });

  const archiveCard = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${activeCardId}/archive`),
    onSuccess: () => { invalidateAll(); setArchiveSheetOpen(false); onClose(); },
  });

  const republishCard = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${activeCardId}/republish`),
    onSuccess: () => { invalidateAll(); setRepublishSheetOpen(false); onClose(); },
  });

  const deleteCard = useMutation({
    mutationFn: () => api.delete(`/admin/subscription-cards/${activeCardId}`),
    onSuccess: () => { invalidateAll(); setDeleteSheetOpen(false); onClose(); },
  });

  const broadcastCard = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${activeCardId}/broadcast`),
    onSuccess: () => { invalidateAll(); setBroadcastSheetOpen(false); },
  });

  const broadcastPending = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${activeCardId}/broadcast-pending`),
    onSuccess: () => { invalidateAll(); },
  });

  const selectPartner = useMutation({
    mutationFn: (partnerId: string) =>
      api.post(`/admin/subscription-cards/${activeCardId}/select-partner`, { partner_id: partnerId }),
    onSuccess: () => invalidateAll(),
  });

  const selectTalent = useMutation({
    mutationFn: (talentId: string) =>
      api.post(`/admin/subscription-cards/${activeCardId}/select-talent`, { talent_id: talentId }),
    onSuccess: () => invalidateAll(),
  });

  const undoSelection = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${activeCardId}/undo-selection`),
    onSuccess: () => { invalidateAll(); setUndoSheetOpen(false); },
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

  const autoAcceptTalent = useMutation({
    mutationFn: ({ talentId, talentName, email }: { talentId: string; talentName: string; email: string }) =>
      api.post(`/admin/subscription-cards/${activeCardId}/auto-accept-talent`, {
        talent_id: talentId,
        talent_name: talentName,
        email,
      }),
    onSuccess: () => { invalidateAll(); setAutoAcceptTarget(null); },
    onError: () => setAutoAcceptTarget(null),
  });

  const createSecondary = useMutation({
    mutationFn: (body: { partner_price_override: number | null; distribution: 'manual' | 'broadcast' }) =>
      api.post(`/admin/subscription-cards/${card.id}/secondary-cards`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      setCreateSecondaryOpen(false);
      setSecondaryPrice('');
      setSecondaryDistribution('manual');
    },
  });

  const hasSelection = activeCard.selected_recipient_type != null;
  const isActive = activeCard.state === 'published';
  const isAssigned = activeCard.state === 'assigned';
  const isManual = activeCard.distribution === 'manual';
  const isArchived = !!activeCard.archived_at;
  const plan = card.submission_subscription?.plan;
  const planLabel = plan ? `${plan.plan} · ${plan.tier}` : '';
  const planPrice = plan?.pricing?.[0];
  const priceCurrency = planPrice?.country?.currency || card.submission?.country?.currency || '';
  const publisher = card.published_by_user;
  const business = card.submission?.business_name || card.brand_name || 'Unknown business';
  const deliveryState = squadhireDeliveryState(activeCard);

  const countryNameById = useMemo(() => {
    const m: Record<string, string> = {};
    countries.forEach((c) => { m[c.id] = c.name; });
    return m;
  }, [countries]);

  const targetCountries = (card.target_country_ids || []).map((id) => countryNameById[id] || id.slice(0, 8));
  const regionsByCountry = useMemo(() => {
    const m: Record<string, string[]> = {};
    (card.target_regions || []).forEach((r) => {
      const name = countryNameById[r.country_id] || r.country_id.slice(0, 8);
      (m[name] = m[name] || []).push(r.region);
    });
    return m;
  }, [card.target_regions, countryNameById]);

  // Manual-mode talent grouping for the recipients list
  const talentGroups = useMemo(() => {
    if (!isManual || !recipients) return null;
    const pending: typeof recipients.talents = [];
    const sentMap = new Map<string, typeof recipients.talents>();
    for (const t of recipients.talents) {
      if (!t.notified_at) {
        pending.push(t);
      } else {
        const arr = sentMap.get(t.notified_at) ?? [];
        arr.push(t);
        sentMap.set(t.notified_at, arr);
      }
    }
    const sentBatches = Array.from(sentMap.entries())
      .map(([notifiedAt, items]) => ({ notifiedAt, items }))
      .sort((a, b) => b.notifiedAt.localeCompare(a.notifiedAt));
    return { pending, sentBatches };
  }, [isManual, recipients]);

  const totalPendingTalents = talentGroups?.pending.length ?? 0;

  const moreActions: React.ComponentProps<typeof MobileActionSheet>['actions'] = [];
  if (isActive && !isArchived) {
    moreActions.push({
      label: cancelCard.isPending ? 'Cancelling…' : 'Cancel this card',
      variant: 'danger',
      disabled: cancelCard.isPending,
      onPress: () => { setMoreSheetOpen(false); setCancelSheetOpen(true); },
    });
    if (isManual) {
      moreActions.push({
        label: broadcastCard.isPending ? 'Broadcasting…' : 'Broadcast to all',
        variant: 'primary',
        disabled: broadcastCard.isPending,
        onPress: () => { setMoreSheetOpen(false); setBroadcastSheetOpen(true); },
      });
    }
  }
  if (!isArchived) {
    moreActions.push({
      label: archiveCard.isPending ? 'Archiving…' : 'Archive card',
      variant: 'violet',
      disabled: archiveCard.isPending,
      onPress: () => { setMoreSheetOpen(false); setArchiveSheetOpen(true); },
    });
  }
  if (isArchived) {
    moreActions.push({
      label: republishCard.isPending ? 'Republishing…' : 'Republish as manual',
      variant: 'primary',
      disabled: republishCard.isPending,
      onPress: () => { setMoreSheetOpen(false); setRepublishSheetOpen(true); },
    });
    moreActions.push({
      label: deleteCard.isPending ? 'Deleting…' : 'Delete permanently',
      variant: 'danger',
      disabled: deleteCard.isPending,
      onPress: () => { setMoreSheetOpen(false); setDeleteSheetOpen(true); },
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col sh-surface" style={{ animation: 'slideUp 0.3s ease-out' }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-sh-warm-border)] bg-white px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            {viewingSecondaryId ? (
              <button
                onClick={() => setViewingSecondaryId(null)}
                className="sh-btn-ghost sh-btn-ghost-sm shrink-0"
                aria-label="Back to primary card"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            ) : null}
            <h3 className="truncate text-base font-semibold text-[var(--color-sh-ink)]">
              {viewingSecondaryId ? 'Secondary Card' : business}
            </h3>
          </div>
          <button onClick={onClose} className="sh-btn-ghost sh-btn-ghost-sm shrink-0" aria-label="Close">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto pb-32">
          <div className="space-y-3 px-4 py-4">
            {/* Status pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="sh-status-pill"
                style={{
                  backgroundColor: isActive ? '#10B9811F' : isAssigned ? '#E0F2FE' : '#EEF2F6',
                  color: isActive ? '#10B981' : isAssigned ? '#075985' : '#475569',
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: isActive ? '#10B981' : isAssigned ? '#0EA5E9' : '#6B7280' }} />
                {isActive ? 'Active' : isAssigned ? 'Assigned' : 'Cancelled'}
              </span>
              <span className="sh-status-pill" style={{ backgroundColor: 'var(--color-sh-cream)', color: 'var(--color-sh-ink-subtle)' }}>
                {isManual ? 'Soft Published' : 'Broadcast'}
              </span>
              {isArchived && (
                <span className="sh-status-pill" style={{ backgroundColor: '#F2EBFE', color: '#6B21A8' }}>
                  Archived
                </span>
              )}
              {activeCard.recalled_at && (
                <span className="sh-status-pill" style={{ backgroundColor: '#FFE9D9', color: '#9A3412' }}>
                  Recalled
                </span>
              )}
              {deliveryState === 'skipped' && (
                <span className="sh-status-pill" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
                  Not on SquadHire
                </span>
              )}
              {deliveryState === 'pending' && (
                <span className="sh-status-pill" style={{ backgroundColor: '#FFE9D9', color: '#9A3412' }}>
                  SquadHire pending
                </span>
              )}
              {activeCard.selected_recipient_type && !isAssigned && (
                <span className="sh-status-pill" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>
                  Selected ({activeCard.selected_recipient_type})
                </span>
              )}
            </div>

            {/* Business & plan */}
            <div className="sh-card p-4">
              <p className="text-base font-semibold text-[var(--color-sh-ink)]">{business}</p>
              {planLabel && <p className="mt-0.5 text-sm text-[var(--color-sh-ink-muted)]">{planLabel}</p>}
              <p className="mt-1 text-xs text-[var(--color-sh-ink-faint)]">
                Published {formatFullDateTime(activeCard.published_at || card.published_at)}
              </p>
              {publisher && (
                <p className="text-xs text-[var(--color-sh-ink-faint)]">
                  by {publisher.display_name || publisher.email || publisher.id.slice(0, 8)}
                </p>
              )}
            </div>

            {/* Lifecycle notices */}
            {isArchived && (
              <div className="sh-card p-4" style={{ backgroundColor: '#F8F2FE', borderColor: '#DDC9F4' }}>
                <p className="text-sm font-semibold text-[#6B21A8]">Archived</p>
                <p className="mt-0.5 text-xs text-[#7E22CE]">
                  {formatFullDateTime(activeCard.archived_at ?? null)} — Hidden from talent feeds and the default Published list. Republish to bring it back as a manual card, or delete it permanently.
                </p>
              </div>
            )}
            {activeCard.recalled_at && (
              <div className="sh-card p-4" style={{ backgroundColor: '#FFF6EE', borderColor: '#F8C9A4' }}>
                <p className="text-sm font-semibold text-[#9A3412]">Recalled</p>
                <p className="mt-0.5 text-xs text-[#B45309]">
                  {formatFullDateTime(activeCard.recalled_at)} — Acceptees still see this card with a "Recalled" tag.
                </p>
              </div>
            )}
            {activeCard.cancelled_at && (
              <div className="sh-card p-4" style={{ backgroundColor: '#FDECEC', borderColor: '#FBCFCB' }}>
                <p className="text-sm font-semibold text-[#B42318]">Cancelled</p>
                <p className="mt-0.5 text-xs text-[#B91C1C]">
                  {formatFullDateTime(activeCard.cancelled_at)} — Acceptees still see this card with a "Cancelled" tag.
                </p>
              </div>
            )}

            {/* Working & Business */}
            {(card.working_days?.length > 0 || card.brand_name || card.business_nature || card.notes) && (
              <DetailCard title="Working & Business">
                {card.working_days?.length > 0 && (
                  <DetailRow label="Working days" value={card.working_days.join(' · ')} />
                )}
                {card.brand_name && <DetailRow label="Brand" value={card.brand_name} />}
                {card.business_nature && <DetailRow label="Nature" value={card.business_nature} />}
                {card.notes && <DetailRow label="Notes" value={card.notes} />}
              </DetailCard>
            )}

            {/* Customer */}
            <DetailCard title="Customer">
              <DetailRow label="Contact Person" value={card.customer_name || EMPTY} />
              <DetailRow label="Email" value={card.customer_email || EMPTY} />
              <DetailRow label="Phone" value={card.customer_phone || EMPTY} />
              <DetailRow label="Location" value={card.customer_location || EMPTY} />
            </DetailCard>

            {/* Targeting */}
            <DetailCard title="Targeting">
              <DetailRow label="Tiers" value={card.target_tiers?.length ? card.target_tiers.join(' · ') : EMPTY} />
              <DetailRow
                label="Min experience"
                value={card.min_experience_years > 0 ? `${card.min_experience_years}+ years` : 'Any'}
              />
              <DetailRow
                label="Languages"
                value={card.target_languages?.length ? card.target_languages.join(' · ') : EMPTY}
              />
              <DetailRow label="Countries" value={targetCountries.length ? targetCountries.join(', ') : EMPTY} />
              {Object.entries(regionsByCountry).map(([country, regions]) => (
                <DetailRow key={country} label={country} value={regions.join(', ')} />
              ))}
              <DetailRow
                label="SquadHire categories"
                value={
                  card.squadhire_category_ids?.length
                    ? card.squadhire_category_ids
                        .map((id) => squadhireCategories.find((c) => c.id === id)?.name || id.slice(0, 8))
                        .join(', ')
                    : EMPTY
                }
              />
            </DetailCard>

            {/* Deliverables */}
            {(card.plan_default_deliverables?.length || card.custom_deliverables?.length) ? (
              <DetailCard title="Deliverables">
                {(card.plan_default_deliverables || []).map((d) => {
                  const disabled = card.disabled_default_deliverable_ids?.includes(d.id) ?? false;
                  const label = d.kind === 'hours' ? 'Hours' : (d.deliverable_type_name || 'Deliverable');
                  return (
                    <DetailRow
                      key={d.id}
                      label={disabled ? `${label} (disabled)` : label}
                      value={formatDeliverable(d)}
                      strikethrough={disabled}
                    />
                  );
                })}
                {(card.custom_deliverables || []).map((d) => (
                  <DetailRow key={d.id} label={d.name} value={formatDeliverable(d)} />
                ))}
              </DetailCard>
            ) : null}

            {/* Pricing */}
            <DetailCard title="Pricing">
              {planPrice && (
                <DetailRow label="Plan price" value={`${priceCurrency} ${planPrice.price.toLocaleString()}`} />
              )}
              {card.proposed_price != null && (
                <DetailRow label="Proposed price" value={`₹${card.proposed_price.toLocaleString()}/mo`} />
              )}
              {card.markup ? (
                <DetailRow label="Margin" value={`₹${card.markup.toLocaleString()}/mo`} />
              ) : null}
              {activeCard.partner_price_override != null ? (
                <DetailRow label="Partner price" value={`${priceCurrency || '₹'} ${activeCard.partner_price_override.toLocaleString()}`} />
              ) : viewingSecondaryId ? (
                <DetailRow label="Partner price" value="Same as primary" />
              ) : card.partner_price_override != null ? (
                <DetailRow label="Partner override" value={`${priceCurrency || '₹'} ${card.partner_price_override.toLocaleString()}`} />
              ) : null}
            </DetailCard>

            {/* Secondary cards (with create form) */}
            {!viewingSecondaryId && !card.parent_card_id && !isArchived && (
              <div className="sh-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="sh-section-heading">
                    Secondary Cards ({secondaryCards?.length ?? 0})
                  </h4>
                  {isActive && (
                    <button
                      onClick={() => setCreateSecondaryOpen(!createSecondaryOpen)}
                      className="sh-btn-ghost sh-btn-ghost-sm"
                    >
                      {createSecondaryOpen ? 'Cancel' : 'Create'}
                    </button>
                  )}
                </div>

                {createSecondaryOpen && (
                  <div className="rounded-xl border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-lime-soft)] p-3 space-y-2.5">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-[var(--color-sh-ink-muted)]">Partner price</label>
                      <input
                        type="number"
                        min={0}
                        value={secondaryPrice}
                        onChange={(e) => setSecondaryPrice(e.target.value)}
                        placeholder={`Same as primary${priceCurrency ? ` (${priceCurrency})` : ''}`}
                        className="sh-input"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-[var(--color-sh-ink-muted)]">Distribution</label>
                      <select
                        value={secondaryDistribution}
                        onChange={(e) => setSecondaryDistribution(e.target.value as 'manual' | 'broadcast')}
                        className="sh-input"
                      >
                        <option value="manual">Publish (manual)</option>
                        <option value="broadcast">Broadcast</option>
                      </select>
                    </div>
                    <button
                      onClick={() => {
                        const priceVal = secondaryPrice.trim() ? parseInt(secondaryPrice, 10) : null;
                        if (priceVal !== null && (isNaN(priceVal) || priceVal < 0)) return;
                        createSecondary.mutate({
                          partner_price_override: priceVal,
                          distribution: secondaryDistribution,
                        });
                      }}
                      disabled={createSecondary.isPending}
                      className="sh-btn-primary sh-btn-primary-sm w-full"
                    >
                      {createSecondary.isPending ? 'Creating…' : 'Create & Publish'}
                    </button>
                  </div>
                )}

                {(secondaryCards?.length ?? 0) === 0 && !createSecondaryOpen ? (
                  <p className="text-xs text-[var(--color-sh-ink-faint)]">No secondary cards yet.</p>
                ) : (
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
                          className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] px-3 py-2.5 text-left transition-colors hover:bg-white"
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
                              <span className="text-[9px] font-semibold text-[var(--color-sh-ink-faint)]">
                                {sc.distribution === 'manual' ? 'Soft Published' : 'Broadcast'}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--color-sh-ink)]">
                              {sc.partner_price_override != null
                                ? `${priceCurrency} ${sc.partner_price_override.toLocaleString()}`
                                : 'Same price'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-bold text-emerald-700">{p.accepted + t.accepted}✓</span>
                            <span className="text-[9px] font-bold text-red-600">{p.rejected + t.rejected}✗</span>
                            <svg className="h-3.5 w-3.5 text-[var(--color-sh-ink-faint)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Recipients */}
            <div className="sh-card p-4">
              <h4 className="sh-section-heading mb-3">Recipients</h4>
              {recipientsLoading ? (
                <p className="py-4 text-center text-xs text-[var(--color-sh-ink-faint)] animate-pulse">Loading recipients…</p>
              ) : (
                <MobileRecipientsList
                  partners={recipients?.partners || []}
                  talents={recipients?.talents || []}
                  hasSelection={hasSelection}
                  isCardActive={isActive}
                  isManual={isManual}
                  talentGroups={talentGroups}
                  onSelectPartner={(id) => selectPartner.mutate(id)}
                  onSelectTalent={(id) => selectTalent.mutate(id)}
                  onRemovePartner={(id) => removePartner.mutate(id)}
                  onRemoveTalent={(id) => removeTalent.mutate(id)}
                  onAutoAcceptTalent={(id, name, email) => setAutoAcceptTarget({ id, name, email })}
                  isSelecting={selectPartner.isPending || selectTalent.isPending}
                  isRemoving={removePartner.isPending || removeTalent.isPending}
                />
              )}
              {/* Broadcast pending (manual cards only) */}
              {isManual && totalPendingTalents > 0 && isActive && (
                <div className="mt-4 rounded-xl border border-[#FCD9B6] bg-[#FEF8E6] p-3 space-y-2">
                  <p className="text-xs font-semibold text-[#9A3412]">
                    {totalPendingTalents} talent{totalPendingTalents === 1 ? '' : 's'} queued — not yet sent to SquadHire.
                  </p>
                  <button
                    onClick={() => broadcastPending.mutate()}
                    disabled={broadcastPending.isPending}
                    className="sh-btn-primary sh-btn-primary-sm w-full"
                  >
                    {broadcastPending.isPending
                      ? 'Broadcasting…'
                      : `Broadcast to these ${totalPendingTalents} user${totalPendingTalents === 1 ? '' : 's'}`}
                  </button>
                  {broadcastPending.isError && (
                    <p className="text-[11px] text-red-600">
                      {(broadcastPending.error as any)?.response?.data?.error || 'Broadcast failed. Try again.'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Lifecycle / SquadHire / Metadata reference sections */}
            <DetailCard title="Lifecycle">
              <DetailRow label="Source" value={card.source ? card.source.charAt(0).toUpperCase() + card.source.slice(1) : EMPTY} />
              {card.subscription_request_id != null && (
                <DetailRow label="Request #" value={String(card.subscription_request_id)} />
              )}
              {card.assigned_at && <DetailRow label="Assigned at" value={formatFullDateTime(card.assigned_at)} />}
              {card.recalled_at && <DetailRow label="Recalled at" value={formatFullDateTime(card.recalled_at)} />}
              {card.cancelled_at && <DetailRow label="Cancelled at" value={formatFullDateTime(card.cancelled_at)} />}
              {card.archived_at && <DetailRow label="Archived at" value={formatFullDateTime(card.archived_at)} />}
              {card.closed_at && <DetailRow label="Closed at" value={formatFullDateTime(card.closed_at)} />}
            </DetailCard>

            <DetailCard title="SquadHire delivery">
              <DetailRow label="Status" value={
                deliveryState === 'delivered' ? 'Delivered'
                : deliveryState === 'pending' ? 'Pending'
                : 'Skipped'
              } />
              {card.squadhire_synced_at && (
                <DetailRow label="Last synced" value={formatFullDateTime(card.squadhire_synced_at)} />
              )}
              {card.squadhire_sync_attempts != null && (
                <DetailRow label="Sync attempts" value={String(card.squadhire_sync_attempts)} />
              )}
              {card.squadhire_sync_last_error && (
                <DetailRow label="Last error" value={card.squadhire_sync_last_error} />
              )}
            </DetailCard>
          </div>
        </div>

        {/* Sticky action bar */}
        <div className="fixed bottom-0 left-0 right-0 z-[55] border-t border-[var(--color-sh-warm-border)] bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex gap-2">
            {isArchived ? (
              <>
                <button
                  onClick={() => setRepublishSheetOpen(true)}
                  className="sh-btn-primary flex-1"
                  style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}
                >
                  Republish
                </button>
                <button
                  onClick={() => setMoreSheetOpen(true)}
                  className="sh-btn-ghost"
                  style={{ padding: '0.75rem 0.875rem', fontSize: '0.875rem' }}
                  aria-label="More actions"
                >
                  ⋯
                </button>
              </>
            ) : isActive && !hasSelection ? (
              <>
                <button
                  onClick={() => setRecallSheetOpen(true)}
                  className="sh-btn-warning flex-1"
                  style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}
                >
                  Recall
                </button>
                <button
                  onClick={() => setAssignOpen(true)}
                  className="sh-btn-primary flex-1"
                  style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}
                >
                  Assign
                </button>
                <button
                  onClick={() => setMoreSheetOpen(true)}
                  className="sh-btn-ghost"
                  style={{ padding: '0.75rem 0.875rem', fontSize: '0.875rem' }}
                  aria-label="More actions"
                >
                  ⋯
                </button>
              </>
            ) : hasSelection ? (
              <>
                <button
                  onClick={() => setUndoSheetOpen(true)}
                  className="sh-btn-ghost flex-1"
                  style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}
                >
                  Undo Selection
                </button>
                <button
                  onClick={() => setMoreSheetOpen(true)}
                  className="sh-btn-ghost"
                  style={{ padding: '0.75rem 0.875rem', fontSize: '0.875rem' }}
                  aria-label="More actions"
                >
                  ⋯
                </button>
              </>
            ) : (
              <p className="flex-1 py-3 text-center text-sm text-[var(--color-sh-ink-faint)]">This card is closed.</p>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation sheets */}
      <MobileActionSheet
        open={recallSheetOpen}
        onClose={() => setRecallSheetOpen(false)}
        title="Recall this card?"
        description="Pending recipients will stop seeing it. Acceptees keep the card with a 'Recalled' tag. This cannot be undone."
        actions={[{
          label: recallCard.isPending ? 'Recalling…' : 'Recall Card',
          variant: 'warning',
          disabled: recallCard.isPending,
          onPress: () => recallCard.mutate(),
        }]}
      />
      <MobileActionSheet
        open={cancelSheetOpen}
        onClose={() => setCancelSheetOpen(false)}
        title="Cancel this card?"
        description="The card moves to the Cancelled state. Acceptees still see it tagged 'Cancelled'. This cannot be undone."
        actions={[{
          label: cancelCard.isPending ? 'Cancelling…' : 'Cancel Card',
          variant: 'danger',
          disabled: cancelCard.isPending,
          onPress: () => cancelCard.mutate(),
        }]}
      />
      <MobileActionSheet
        open={archiveSheetOpen}
        onClose={() => setArchiveSheetOpen(false)}
        title="Archive this card?"
        description="Hidden from talent feeds and the default Published list. Republish later if needed."
        actions={[{
          label: archiveCard.isPending ? 'Archiving…' : 'Archive Card',
          variant: 'violet',
          disabled: archiveCard.isPending,
          onPress: () => archiveCard.mutate(),
        }]}
      />
      <MobileActionSheet
        open={republishSheetOpen}
        onClose={() => setRepublishSheetOpen(false)}
        title="Republish this card?"
        description="Republishes as a manual card so you can broadcast or hand-pick recipients."
        actions={[{
          label: republishCard.isPending ? 'Republishing…' : 'Republish',
          variant: 'primary',
          disabled: republishCard.isPending,
          onPress: () => republishCard.mutate(),
        }]}
      />
      <MobileActionSheet
        open={deleteSheetOpen}
        onClose={() => setDeleteSheetOpen(false)}
        title="Delete this card permanently?"
        description="Recipients and any secondary cards will be deleted with it. This cannot be undone."
        actions={[{
          label: deleteCard.isPending ? 'Deleting…' : 'Delete Permanently',
          variant: 'danger',
          disabled: deleteCard.isPending,
          onPress: () => deleteCard.mutate(),
        }]}
      />
      <MobileActionSheet
        open={broadcastSheetOpen}
        onClose={() => setBroadcastSheetOpen(false)}
        title="Broadcast to all?"
        description="Sends this manual card to every matching talent on SquadHire."
        actions={[{
          label: broadcastCard.isPending ? 'Broadcasting…' : 'Broadcast',
          variant: 'primary',
          disabled: broadcastCard.isPending,
          onPress: () => broadcastCard.mutate(),
        }]}
      />
      <MobileActionSheet
        open={undoSheetOpen}
        onClose={() => setUndoSheetOpen(false)}
        title="Undo selection?"
        description="The card will reopen as published and the selected recipient will be deselected."
        actions={[{
          label: undoSelection.isPending ? 'Undoing…' : 'Undo Selection',
          variant: 'primary',
          disabled: undoSelection.isPending,
          onPress: () => undoSelection.mutate(),
        }]}
      />
      <MobileActionSheet
        open={moreSheetOpen}
        onClose={() => setMoreSheetOpen(false)}
        title="More actions"
        description="Card lifecycle and distribution controls."
        actions={moreActions}
      />
      <MobileActionSheet
        open={!!autoAcceptTarget}
        onClose={() => setAutoAcceptTarget(null)}
        title="Auto-accept talent?"
        description={
          autoAcceptTarget
            ? `Accept this card on behalf of ${autoAcceptTarget.name} (${autoAcceptTarget.email}). They'll be visible to the business user immediately. Requires a matching SquadHub user account.`
            : ''
        }
        actions={[{
          label: autoAcceptTalent.isPending ? 'Accepting…' : 'Auto-accept',
          variant: 'success',
          disabled: autoAcceptTalent.isPending,
          onPress: () => {
            if (autoAcceptTarget) {
              autoAcceptTalent.mutate({
                talentId: autoAcceptTarget.id,
                talentName: autoAcceptTarget.name,
                email: autoAcceptTarget.email,
              });
            }
          },
        }]}
      />

      {assignOpen && (
        <MobileAssignModal cardId={activeCardId} onClose={() => setAssignOpen(false)} />
      )}
    </>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sh-card p-4">
      <h4 className="sh-section-heading mb-3">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, strikethrough }: { label: string; value: string; strikethrough?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs text-[var(--color-sh-ink-faint)]">{label}</span>
      <span
        className="text-right text-xs font-semibold text-[var(--color-sh-ink)]"
        style={strikethrough ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
