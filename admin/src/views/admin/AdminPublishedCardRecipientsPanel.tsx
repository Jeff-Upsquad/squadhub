'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import AssignRecipientPicker from './AssignRecipientPicker';
import type { PublishedCard } from './AdminPublishedCards';

export type PartnerRecipient = {
  id: string;
  name: string;
  status: 'pending' | 'accepted' | 'rejected';
  responded_at: string | null;
  assigned_manually?: boolean;
  selected_at?: string | null;
  selected_by?: string | null;
  passed_over_at?: string | null;
};

export type TalentRecipient = {
  external_user_id: string;
  name: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  responded_at: string | null;
  assigned_manually?: boolean;
  selected_at?: string | null;
  selected_by?: string | null;
  passed_over_at?: string | null;
};

export type RecipientsResponse = {
  partners: PartnerRecipient[];
  talents: TalentRecipient[];
};

type Country = { id: string; name: string; currency: string };

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
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

const STATUS_CHIP: Record<'pending' | 'accepted' | 'rejected', string> = {
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
};

export default function AdminPublishedCardRecipientsPanel({
  card,
  title,
  onClose,
}: {
  card: PublishedCard;
  title: string;
  onClose: () => void;
}) {
  const [viewingSecondaryId, setViewingSecondaryId] = useState<string | null>(null);
  const qc = useQueryClient();

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
  const isSecondaryView = !!activeSecondary;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-[480px] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          {isSecondaryView ? (
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setViewingSecondaryId(null)}
                className="shrink-0 rounded-md p-1 text-[#62748E] hover:bg-[#F8FAFC]"
                title="Back to primary card"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h3 className="text-base font-semibold text-[#0F172B] truncate">Secondary Card</h3>
            </div>
          ) : (
            <h3 className="text-base font-semibold text-[#0F172B] truncate">{title}</h3>
          )}
          <button onClick={onClose} className="rounded-md p-1 text-[#62748E] hover:bg-[#F8FAFC]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <CardPanelContent
          card={card}
          activeCard={activeCard}
          activeCardId={activeCardId}
          isSecondaryView={isSecondaryView}
          secondaryCards={secondaryCards || []}
          onViewSecondary={setViewingSecondaryId}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function CardPanelContent({
  card,
  activeCard,
  activeCardId,
  isSecondaryView,
  secondaryCards,
  onViewSecondary,
  onClose,
}: {
  card: PublishedCard;
  activeCard: PublishedCard;
  activeCardId: string;
  isSecondaryView: boolean;
  secondaryCards: PublishedCard[];
  onViewSecondary: (id: string | null) => void;
  onClose: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-card-recipients', activeCardId],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${activeCardId}/recipients`).then((r) => r.data?.data as RecipientsResponse),
  });

  const removePartner = useMutation({
    mutationFn: (partnerId: string) =>
      api.delete(`/admin/subscription-cards/${activeCardId}/recipients/${partnerId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
    },
    onError: (err: any) =>
      alert(err?.response?.data?.error || err.message || 'Failed to remove partner'),
  });

  const removeTalent = useMutation({
    mutationFn: (talentId: string) =>
      api.delete(`/admin/subscription-cards/${activeCardId}/external-recipients/${talentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
    },
    onError: (err: any) =>
      alert(err?.response?.data?.error || err.message || 'Failed to remove talent'),
  });

  const selectPartner = useMutation({
    mutationFn: (partnerId: string) =>
      api.post(`/admin/subscription-cards/${activeCardId}/select-partner`, { partner_id: partnerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
    },
    onError: (err: any) =>
      alert(err?.response?.data?.error || err.message || 'Failed to select partner'),
  });

  const selectTalent = useMutation({
    mutationFn: (talentId: string) =>
      api.post(`/admin/subscription-cards/${activeCardId}/select-talent`, { talent_id: talentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
    },
    onError: (err: any) =>
      alert(err?.response?.data?.error || err.message || 'Failed to select talent'),
  });

  const undoSelection = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/undo-selection`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
    },
    onError: (err: any) =>
      alert(err?.response?.data?.error || err.message || 'Failed to undo selection'),
  });

  const recallCard = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/recall`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      if (isSecondaryView) onViewSecondary(null);
      setRecallConfirmOpen(false);
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error || err.message || 'Failed to recall card');
      setRecallConfirmOpen(false);
    },
  });

  const [recallConfirmOpen, setRecallConfirmOpen] = useState(false);

  const hasSelection = activeCard.selected_recipient_type != null;

  function confirmRemovePartner(partnerId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this card? They'll stop seeing it in their opportunities.`)) {
      return;
    }
    removePartner.mutate(partnerId);
  }
  function confirmRemoveTalent(talentId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this card? They'll stop seeing it in their subscription tab.`)) {
      return;
    }
    removeTalent.mutate(talentId);
  }
  function confirmSelectPartner(partnerId: string, name: string) {
    if (!window.confirm(`Select ${name} for this card? Other acceptees will be passed over and the card will close.`)) return;
    selectPartner.mutate(partnerId);
  }
  function confirmSelectTalent(talentId: string, name: string) {
    if (!window.confirm(`Select ${name} for this card? Other acceptees will be passed over and the card will close.`)) return;
    selectTalent.mutate(talentId);
  }
  function confirmUndoSelection() {
    if (!window.confirm('Undo the selection? The card will reopen as published.')) return;
    undoSelection.mutate();
  }

  // Recall flow: if anyone has accepted, open the extra-confirm modal.
  // Otherwise a simple confirm() is enough.
  function startRecall() {
    const acceptedCount =
      (data?.partners || []).filter((p) => p.status === 'accepted').length +
      (data?.talents || []).filter((t) => t.status === 'accepted').length;
    if (acceptedCount > 0) {
      setRecallConfirmOpen(true);
      return;
    }
    if (!window.confirm('Recall this card? Pending recipients will stop seeing it.')) return;
    recallCard.mutate();
  }

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

  const partnerGroups = useMemo(() => {
    const accepted = (data?.partners || []).filter((p) => p.status === 'accepted');
    const rejected = (data?.partners || []).filter((p) => p.status === 'rejected');
    const pending = (data?.partners || []).filter((p) => p.status === 'pending');
    return { accepted, rejected, pending };
  }, [data]);

  const talentGroups = useMemo(() => {
    const accepted = (data?.talents || []).filter((t) => t.status === 'accepted');
    const rejected = (data?.talents || []).filter((t) => t.status === 'rejected');
    const pending = (data?.talents || []).filter((t) => t.status === 'pending');
    return { accepted, rejected, pending };
  }, [data]);

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <CardDetails card={card} activeCard={activeCard} isSecondaryView={isSecondaryView} countries={countries} squadhireCategories={squadhireCategories} />

        {activeCard.state === 'published' && (
          <div className="border-b border-[#E2E8F0] px-5 py-2.5">
            <button
              onClick={startRecall}
              disabled={recallCard.isPending}
              className="rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
            >
              {recallCard.isPending ? 'Recalling…' : 'Recall this card'}
            </button>
          </div>
        )}

        {activeCard.recalled_at && (
          <div className="border-b border-[#E2E8F0] bg-orange-50 px-5 py-2.5">
            <p className="text-xs text-orange-800">
              <span className="font-semibold">Recalled</span> on {formatFullDateTime(activeCard.recalled_at)}.
              Acceptees still see this card with a "Recalled" tag.
            </p>
          </div>
        )}

        {!isSecondaryView && !card.parent_card_id && (
          <SecondaryCardsSection
            parentCard={card}
            secondaryCards={secondaryCards}
            onViewSecondary={onViewSecondary}
          />
        )}

        <div className="flex items-center justify-between border-y border-[#E2E8F0] bg-[#F8FAFC] px-5 py-2.5">
          {hasSelection ? (
            <>
              <p className="text-xs text-blue-700 font-medium">A recipient has been selected for this card.</p>
              <button
                onClick={confirmUndoSelection}
                disabled={undoSelection.isPending}
                className="rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#62748E] hover:bg-[#F8FAFC] disabled:opacity-50"
              >
                Undo selection
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-[#62748E]">Hand-pick a partner or talent for this card.</p>
              <button
                onClick={() => setPickerOpen(true)}
                className="rounded-md bg-[#0F172B] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                Assign
              </button>
            </>
          )}
        </div>
        <div className="p-5 space-y-6 text-sm">
          {isLoading ? (
            <p className="text-center text-xs text-[#90A1B9]">Loading…</p>
          ) : error ? (
            <p className="text-center text-xs text-red-600">Failed to load recipients.</p>
          ) : (
            <>
              <Section title="Partners">
                <Subgroup
                  label="Accepted"
                  onRemove={(id, name) => confirmRemovePartner(id, name)}
                  isRemoving={removePartner.isPending}
                  onSelect={!hasSelection && activeCard.state === 'published' ? (id, name) => confirmSelectPartner(id, name) : undefined}
                  isSelecting={selectPartner.isPending}
                  items={partnerGroups.accepted.map((p) => ({
                    key: p.id, name: p.name, status: p.status, responded_at: p.responded_at, assigned_manually: !!p.assigned_manually,
                    selected_at: p.selected_at ?? null, passed_over_at: p.passed_over_at ?? null,
                  }))}
                />
                <Subgroup
                  label="Rejected"
                  onRemove={(id, name) => confirmRemovePartner(id, name)}
                  isRemoving={removePartner.isPending}
                  items={partnerGroups.rejected.map((p) => ({
                    key: p.id, name: p.name, status: p.status, responded_at: p.responded_at, assigned_manually: !!p.assigned_manually,
                    selected_at: null, passed_over_at: null,
                  }))}
                />
                <Subgroup
                  label="Pending"
                  onRemove={(id, name) => confirmRemovePartner(id, name)}
                  isRemoving={removePartner.isPending}
                  items={partnerGroups.pending.map((p) => ({
                    key: p.id, name: p.name, status: p.status, responded_at: null, assigned_manually: !!p.assigned_manually,
                    selected_at: null, passed_over_at: null,
                  }))}
                />
              </Section>
              <Section title="Talents">
                <Subgroup
                  label="Accepted"
                  onRemove={(id, name) => confirmRemoveTalent(id, name)}
                  isRemoving={removeTalent.isPending}
                  onSelect={!hasSelection && activeCard.state === 'published' ? (id, name) => confirmSelectTalent(id, name) : undefined}
                  isSelecting={selectTalent.isPending}
                  items={talentGroups.accepted.map((t) => ({
                    key: t.external_user_id,
                    name: t.name || 'Unknown talent',
                    subtitle: t.external_user_id.slice(0, 8),
                    status: t.status,
                    responded_at: t.responded_at,
                    assigned_manually: !!t.assigned_manually,
                    selected_at: t.selected_at ?? null, passed_over_at: t.passed_over_at ?? null,
                  }))}
                />
                <Subgroup
                  label="Rejected"
                  onRemove={(id, name) => confirmRemoveTalent(id, name)}
                  isRemoving={removeTalent.isPending}
                  items={talentGroups.rejected.map((t) => ({
                    key: t.external_user_id,
                    name: t.name || 'Unknown talent',
                    subtitle: t.external_user_id.slice(0, 8),
                    status: t.status,
                    responded_at: t.responded_at,
                    assigned_manually: !!t.assigned_manually,
                    selected_at: null, passed_over_at: null,
                  }))}
                />
                <Subgroup
                  label="Pending"
                  onRemove={(id, name) => confirmRemoveTalent(id, name)}
                  isRemoving={removeTalent.isPending}
                  items={talentGroups.pending.map((t) => ({
                    key: t.external_user_id,
                    name: t.name || 'Unknown talent',
                    subtitle: t.external_user_id.slice(0, 8),
                    status: t.status,
                    responded_at: null,
                    assigned_manually: !!t.assigned_manually,
                    selected_at: null, passed_over_at: null,
                  }))}
                />
              </Section>
            </>
          )}
        </div>
      </div>
      {pickerOpen && (
        <AssignRecipientPicker cardId={activeCardId} onClose={() => setPickerOpen(false)} />
      )}
      {recallConfirmOpen && (
        <RecallConfirmModal
          acceptedPartners={partnerGroups.accepted.length}
          acceptedTalents={talentGroups.accepted.length}
          isPending={recallCard.isPending}
          onCancel={() => setRecallConfirmOpen(false)}
          onConfirm={() => recallCard.mutate()}
        />
      )}
    </>
  );
}

function RecallConfirmModal({
  acceptedPartners,
  acceptedTalents,
  isPending,
  onCancel,
  onConfirm,
}: {
  acceptedPartners: number;
  acceptedTalents: number;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const total = acceptedPartners + acceptedTalents;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative w-[420px] rounded-lg bg-white p-5 shadow-xl">
        <h4 className="text-base font-semibold text-[#0F172B]">Recall card with acceptances?</h4>
        <p className="mt-2 text-sm text-[#62748E]">
          This card has{' '}
          <span className="font-semibold text-[#0F172B]">
            {total} {total === 1 ? 'acceptance' : 'acceptances'}
          </span>{' '}
          ({acceptedPartners} partner{acceptedPartners === 1 ? '' : 's'}, {acceptedTalents} talent
          {acceptedTalents === 1 ? '' : 's'}). Recalling will:
        </p>
        <ul className="mt-2 space-y-1 text-xs text-[#62748E]">
          <li>• Drop pending recipients (they stop seeing the card).</li>
          <li>• Keep acceptees in their feed with a "Recalled" tag.</li>
          <li>• Mark the card terminal — no re-publish.</li>
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#62748E] hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {isPending ? 'Recalling…' : 'Recall anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Secondary Cards Section
// ============================================================

function SecondaryCardsSection({
  parentCard,
  secondaryCards,
  onViewSecondary,
}: {
  parentCard: PublishedCard;
  secondaryCards: PublishedCard[];
  onViewSecondary: (id: string) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [price, setPrice] = useState<string>('');
  const [distribution, setDistribution] = useState<'broadcast' | 'manual'>('manual');
  const qc = useQueryClient();

  const createSecondary = useMutation({
    mutationFn: (body: { partner_price_override?: number | null; distribution: string }) =>
      api.post(`/admin/subscription-cards/${parentCard.id}/secondary-cards`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', parentCard.id] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      setFormOpen(false);
      setPrice('');
      setDistribution('manual');
    },
    onError: (err: any) =>
      alert(err?.response?.data?.error || err.message || 'Failed to create secondary card'),
  });

  function handleCreate() {
    const priceVal = price.trim() ? parseInt(price, 10) : null;
    if (priceVal !== null && (isNaN(priceVal) || priceVal < 0)) {
      alert('Price must be a positive number');
      return;
    }
    createSecondary.mutate({
      partner_price_override: priceVal,
      distribution,
    });
  }

  const plan = parentCard.submission_subscription?.plan;
  const planPrice = plan?.pricing?.[0];
  const priceCurrency = planPrice?.country?.currency || parentCard.submission?.country?.currency || '';

  return (
    <div className="border-b border-[#E2E8F0] px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#90A1B9]">
          Secondary Cards ({secondaryCards.length})
        </h4>
        {parentCard.state === 'published' && (
          <button
            onClick={() => setFormOpen(!formOpen)}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-indigo-700"
          >
            {formOpen ? 'Cancel' : 'Create'}
          </button>
        )}
      </div>

      {formOpen && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#62748E] w-24 shrink-0">Partner price</label>
            <div className="flex items-center gap-1 flex-1">
              {priceCurrency && <span className="text-xs text-[#90A1B9]">{priceCurrency}</span>}
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Same as primary"
                className="w-full rounded-md border border-[#E2E8F0] bg-white px-2 py-1.5 text-xs text-[#0F172B] placeholder:text-[#90A1B9] focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#62748E] w-24 shrink-0">Distribution</label>
            <select
              value={distribution}
              onChange={(e) => setDistribution(e.target.value as 'broadcast' | 'manual')}
              className="flex-1 rounded-md border border-[#E2E8F0] bg-white px-2 py-1.5 text-xs text-[#0F172B] focus:outline-none focus:ring-1 focus:ring-indigo-300"
            >
              <option value="manual">Soft publish (manual)</option>
              <option value="broadcast">Broadcast</option>
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={createSecondary.isPending}
            className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {createSecondary.isPending ? 'Creating…' : 'Create & Publish'}
          </button>
        </div>
      )}

      {secondaryCards.length === 0 && !formOpen && (
        <p className="text-xs text-[#90A1B9]">No secondary cards yet.</p>
      )}

      {secondaryCards.length > 0 && (
        <ul className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
          {secondaryCards.map((sc) => {
            const isRecalled = !!sc.recalled_at;
            const stateColor = sc.state === 'published' ? '#10B981' : isRecalled ? '#EA580C' : '#6B7280';
            const stateLabel = sc.state === 'published' ? 'Active' : isRecalled ? 'Recalled' : 'Closed';
            const distLabel = sc.distribution === 'manual' ? 'Soft publish' : 'Broadcast';
            const partners = sc.recipient_counts?.partners ?? { pending: 0, accepted: 0, rejected: 0 };
            const talents = sc.recipient_counts?.talents ?? { accepted: 0, rejected: 0 };
            return (
              <li key={sc.id}>
                <button
                  onClick={() => onViewSecondary(sc.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[#F8FAFC] transition"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                        style={{ backgroundColor: `${stateColor}18`, color: stateColor }}
                      >
                        <span className="h-1 w-1 rounded-full" style={{ backgroundColor: stateColor }} />
                        {stateLabel}
                      </span>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                        {distLabel}
                      </span>
                    </div>
                    <p className="text-xs text-[#0F172B]">
                      {sc.partner_price_override != null
                        ? `${priceCurrency} ${sc.partner_price_override.toLocaleString()}`
                        : 'Same price as primary'}
                    </p>
                    <p className="text-[10px] text-[#90A1B9]">
                      Published {formatRelative(sc.published_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-700">
                      <span className="text-emerald-700">{partners.accepted + talents.accepted}&#10003;</span>
                      <span className="text-red-600">{partners.rejected + talents.rejected}&#10007;</span>
                      <span className="text-amber-700">{partners.pending}&#9203;</span>
                    </span>
                    <svg className="h-3.5 w-3.5 text-[#90A1B9]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ============================================================
// Card Details
// ============================================================

function CardDetails({ card, activeCard, isSecondaryView, countries, squadhireCategories }: { card: PublishedCard; activeCard: PublishedCard; isSecondaryView: boolean; countries: Country[]; squadhireCategories: Array<{ id: string; name: string }> }) {
  const plan = card.submission_subscription?.plan;
  const planLabel = plan ? `${plan.plan} · ${plan.tier}` : '';
  const fallbackPlanLabel = !planLabel
    ? [card.service_type, card.plan_name].filter(Boolean).join(' · ')
    : '';
  const stateColor = activeCard.state === 'published' ? '#10B981' : '#6B7280';
  const stateLabel = activeCard.state === 'published' ? 'Active' : 'Cancelled';
  const distLabel = activeCard.distribution === 'manual' ? 'Soft publish' : 'Broadcast';
  const publisher = card.published_by_user;
  const sourceBadge =
    card.source === 'request' ? 'From request' : card.source === 'custom' ? 'Custom' : null;

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

  const planPrice = plan?.pricing?.[0];
  const priceCurrency = planPrice?.country?.currency || card.submission?.country?.currency || '';

  return (
    <div className="border-b border-[#E2E8F0] px-5 py-4 space-y-4 text-sm">
      {isSecondaryView && (
        <div className="rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2">
          <p className="text-[11px] font-medium text-indigo-700">
            Secondary card — content inherited from primary
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: `${stateColor}18`, color: stateColor }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
            {stateLabel}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{distLabel}</span>
          {sourceBadge && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">{sourceBadge}</span>
          )}
        </div>
        {(planLabel || fallbackPlanLabel) && (
          <p className="text-xs text-[#62748E]">{planLabel || fallbackPlanLabel}</p>
        )}
        <p className="text-xs text-[#62748E]">
          Published {formatFullDateTime(activeCard.published_at || card.published_at)}
          {publisher && (
            <> by {publisher.display_name || publisher.email || publisher.id.slice(0, 8)}</>
          )}
        </p>
        {card.publish_targets && card.publish_targets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-[#90A1B9]">Published to:</span>
            {card.publish_targets.map((t) => (
              <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </span>
            ))}
          </div>
        )}
      </div>

      {(card.working_days?.length || card.brand_name || card.business_nature || card.notes) && (
        <DetailSection title="Working & business">
          {card.working_days?.length > 0 && <DetailRow label="Working days" value={card.working_days.join(' · ')} />}
          {card.brand_name && <DetailRow label="Brand" value={card.brand_name} />}
          {card.business_nature && <DetailRow label="Nature" value={card.business_nature} />}
          {card.notes && <DetailRow label="Notes" value={card.notes} multiline />}
        </DetailSection>
      )}

      {(card.customer_company || card.customer_name || card.customer_email || card.customer_phone || card.customer_location) && (
        <DetailSection title="Customer">
          {card.customer_company && <DetailRow label="Company" value={card.customer_company} />}
          {card.customer_name && <DetailRow label="Contact" value={card.customer_name} />}
          {card.customer_email && <DetailRow label="Email" value={card.customer_email} />}
          {card.customer_phone && <DetailRow label="Phone" value={card.customer_phone} />}
          {card.customer_location && <DetailRow label="Location" value={card.customer_location} />}
        </DetailSection>
      )}

      {(card.target_tiers?.length || card.min_experience_years > 0 || card.target_languages?.length || targetCountries.length || Object.keys(regionsByCountry).length > 0 || (card.squadhire_category_ids?.length || 0) > 0) && (
        <DetailSection title="Targeting">
          {card.target_tiers?.length > 0 && <DetailRow label="Tiers" value={card.target_tiers.join(' · ')} />}
          {card.min_experience_years > 0 && <DetailRow label="Min experience" value={`${card.min_experience_years}+ years`} />}
          {card.target_languages?.length > 0 && <DetailRow label="Languages" value={card.target_languages.join(' · ')} />}
          {targetCountries.length > 0 && <DetailRow label="Countries" value={targetCountries.join(', ')} />}
          {Object.entries(regionsByCountry).map(([country, regions]) => (
            <DetailRow key={country} label={country} value={regions.join(', ')} />
          ))}
          {card.squadhire_category_ids && card.squadhire_category_ids.length > 0 && (
            <DetailRow
              label="SquadHire categories"
              value={card.squadhire_category_ids
                .map((id) => squadhireCategories.find((c) => c.id === id)?.name || id.slice(0, 8))
                .join(', ')}
            />
          )}
        </DetailSection>
      )}

      {(card.custom_deliverables?.length > 0 || (card.disabled_default_deliverable_ids?.length || 0) > 0) && (
        <DetailSection title="Deliverables">
          {(card.custom_deliverables || []).map((d) => (
            <DetailRow key={d.id} label={d.name} value={formatDeliverable(d)} />
          ))}
          {(card.disabled_default_deliverable_ids?.length || 0) > 0 && (
            <p className="text-[11px] text-[#90A1B9]">
              {card.disabled_default_deliverable_ids.length} plan default{card.disabled_default_deliverable_ids.length === 1 ? '' : 's'} disabled
            </p>
          )}
        </DetailSection>
      )}

      <DetailSection title="Pricing">
        {planPrice && <DetailRow label="Plan price" value={`${priceCurrency} ${planPrice.price.toLocaleString()}`} />}
        {card.proposed_price != null && card.proposed_price > 0 && (
          <DetailRow label="Proposed price" value={`₹${card.proposed_price.toLocaleString()}/mo`} />
        )}
        {card.markup != null && card.markup > 0 && (
          <DetailRow label="Margin" value={`₹${card.markup.toLocaleString()}/mo`} />
        )}
        {card.proposed_price != null && card.proposed_price > 0 && (
          <DetailRow
            label="Partner price (computed)"
            value={`₹${Math.max(0, card.proposed_price - (card.markup || 0)).toLocaleString()}/mo`}
          />
        )}
        {activeCard.partner_price_override != null ? (
          <DetailRow label="Partner price override" value={`${priceCurrency || '₹'} ${activeCard.partner_price_override.toLocaleString()}`} />
        ) : isSecondaryView ? (
          <DetailRow label="Partner price" value="Same as primary" />
        ) : card.partner_price_override != null ? (
          <DetailRow label="Partner override" value={`${priceCurrency || '₹'} ${card.partner_price_override.toLocaleString()}`} />
        ) : null}
      </DetailSection>
    </div>
  );
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

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#90A1B9]">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={`flex gap-3 ${multiline ? 'flex-col' : 'justify-between'}`}>
      <span className="text-xs text-[#90A1B9]">{label}</span>
      <span className={`text-xs text-[#0F172B] ${multiline ? '' : 'text-right'}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Subgroup({
  label,
  items,
  onRemove,
  isRemoving,
  onSelect,
  isSelecting,
}: {
  label: 'Accepted' | 'Rejected' | 'Pending';
  items: { key: string; name: string; subtitle?: string | null; status: 'accepted' | 'rejected' | 'pending'; responded_at: string | null; assigned_manually?: boolean; selected_at?: string | null; passed_over_at?: string | null }[];
  onRemove?: (key: string, name: string) => void;
  isRemoving?: boolean;
  onSelect?: (key: string, name: string) => void;
  isSelecting?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-[#62748E]">{label} (0)</p>
        <p className="text-xs text-[#90A1B9]">None.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-[#62748E]">
        {label} ({items.length})
      </p>
      <ul className="divide-y divide-[#E2E8F0] rounded-lg border border-[#E2E8F0]">
        {items.map((it) => (
          <li key={it.key} className="group flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0 flex-1 truncate">
              <p className="truncate text-sm text-[#0F172B]">{it.name}</p>
              {it.subtitle && (
                <p className="truncate text-[11px] font-mono text-[#90A1B9]">{it.subtitle}</p>
              )}
              {it.responded_at && (
                <p className="text-[11px] text-[#90A1B9]">{formatRelative(it.responded_at)}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {it.selected_at && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                  Selected
                </span>
              )}
              {it.passed_over_at && !it.selected_at && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  Not selected
                </span>
              )}
              {it.assigned_manually && (
                <span
                  className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#62748E]"
                  title="Hand-picked by an admin (not auto-broadcast)"
                >
                  Manual
                </span>
              )}
              {!it.selected_at && !it.passed_over_at && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP[it.status]}`}>
                  {it.status}
                </span>
              )}
              {onSelect && !it.selected_at && !it.passed_over_at && (
                <button
                  type="button"
                  disabled={isSelecting}
                  onClick={() => onSelect(it.key, it.name)}
                  title={`Select ${it.name}`}
                  className="rounded-md bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100 hover:bg-blue-700 disabled:opacity-30"
                >
                  Select
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={() => onRemove(it.key, it.name)}
                  aria-label={`Remove ${it.name}`}
                  title="Remove from this card"
                  className="rounded-md p-1 text-[#90A1B9] opacity-0 transition group-hover:opacity-100 hover:bg-[#F8FAFC] hover:text-red-600 disabled:opacity-30"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
