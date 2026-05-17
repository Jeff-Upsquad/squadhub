'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useSquadhireConfig } from '@/hooks/useSquadhireConfig';
import AssignRecipientPicker from './AssignRecipientPicker';
import ConfirmDialog from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import type { PublishedCard } from './AdminPublishedCards';

export type PartnerRecipient = {
  id: string;
  name: string;
  user_type?: 'partner' | 'partner_employee' | null;
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
  email?: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  responded_at: string | null;
  assigned_manually?: boolean;
  selected_at?: string | null;
  selected_by?: string | null;
  passed_over_at?: string | null;
  notified_at?: string | null;
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

const STATUS_CHIP: Record<'pending' | 'accepted' | 'rejected', { bg: string; color: string }> = {
  accepted: { bg: '#D1FAE5', color: '#065F46' },
  rejected: { bg: '#FEE2E2', color: '#B91C1C' },
  pending: { bg: '#FEF3C7', color: '#92400E' },
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
      <div className="relative flex h-full w-[480px] flex-col bg-[var(--color-sh-cream)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-sh-warm-border)] bg-white px-5 py-4">
          {isSecondaryView ? (
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setViewingSecondaryId(null)}
                className="shrink-0 rounded-md p-1 text-[var(--color-sh-ink-muted)] hover:bg-[var(--color-sh-cream)] transition"
                title="Back to primary card"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h3 className="sh-display text-base truncate">Secondary Card</h3>
            </div>
          ) : (
            <h3 className="sh-display text-base truncate pr-2">{title}</h3>
          )}
          <button onClick={onClose} className="rounded-md p-1 text-[var(--color-sh-ink-muted)] hover:bg-[var(--color-sh-cream)] transition">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
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
  const { adminUrl, configured: shConfigured } = useSquadhireConfig();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-card-recipients', activeCardId],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${activeCardId}/recipients`).then((r) => r.data?.data as RecipientsResponse),
  });

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const clearConfirm = () => setConfirmAction(null);

  const removePartner = useMutation({
    mutationFn: (partnerId: string) =>
      api.delete(`/admin/subscription-cards/${activeCardId}/recipients/${partnerId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to remove partner', 'error');
      clearConfirm();
    },
  });

  const removeTalent = useMutation({
    mutationFn: (talentId: string) =>
      api.delete(`/admin/subscription-cards/${activeCardId}/external-recipients/${talentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to remove talent', 'error');
      clearConfirm();
    },
  });

  const selectPartner = useMutation({
    mutationFn: (partnerId: string) =>
      api.post(`/admin/subscription-cards/${activeCardId}/select-partner`, { partner_id: partnerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to select partner', 'error');
      clearConfirm();
    },
  });

  const autoAcceptPartner = useMutation({
    mutationFn: (partnerId: string) =>
      api.post(`/admin/subscription-cards/${activeCardId}/auto-accept-partner`, { partner_id: partnerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      clearConfirm();
      showToast('Partner-employee accepted on their behalf.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to auto-accept partner', 'error');
      clearConfirm();
    },
  });

  const selectTalent = useMutation({
    mutationFn: (talentId: string) =>
      api.post(`/admin/subscription-cards/${activeCardId}/select-talent`, { talent_id: talentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to select talent', 'error');
      clearConfirm();
    },
  });

  const undoSelection = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/undo-selection`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to undo selection', 'error');
      clearConfirm();
    },
  });

  const recallCard = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/recall`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      if (isSecondaryView) onViewSecondary(null);
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to recall card', 'error');
      clearConfirm();
    },
  });

  const cancelCard = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      if (isSecondaryView) onViewSecondary(null);
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to cancel card', 'error');
      clearConfirm();
    },
  });

  const archiveCard = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/archive`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      if (isSecondaryView) onViewSecondary(null);
      clearConfirm();
      onClose();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to archive card', 'error');
      clearConfirm();
    },
  });

  const republishCard = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/republish`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      if (isSecondaryView) onViewSecondary(null);
      clearConfirm();
      showToast('Card republished as manual — broadcast or hand-pick from here.', 'success');
      onClose();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to republish card', 'error');
      clearConfirm();
    },
  });

  const deleteCard = useMutation({
    mutationFn: () =>
      api.delete(`/admin/subscription-cards/${activeCardId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      clearConfirm();
      showToast('Card deleted permanently.', 'success');
      onClose();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to delete card', 'error');
      clearConfirm();
    },
  });

  const broadcastCard = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/broadcast`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to broadcast card', 'error');
      clearConfirm();
    },
  });

  const hasSelection = activeCard.selected_recipient_type != null;

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

        {activeCard.state === 'published' && !activeCard.archived_at && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-3">
            <button
              onClick={() => setConfirmAction({ kind: 'recall' })}
              disabled={recallCard.isPending}
              className="sh-btn-warning"
            >
              {recallCard.isPending ? 'Recalling…' : 'Recall this card'}
            </button>
            <button
              onClick={() => setConfirmAction({ kind: 'cancel' })}
              disabled={cancelCard.isPending}
              className="sh-btn-danger"
            >
              {cancelCard.isPending ? 'Cancelling…' : 'Cancel this card'}
            </button>
            {activeCard.distribution === 'manual' && (
              <button
                onClick={() => setConfirmAction({ kind: 'broadcast' })}
                disabled={broadcastCard.isPending}
                className="sh-btn-primary sh-btn-primary-sm"
              >
                {broadcastCard.isPending ? 'Broadcasting…' : 'Broadcast to all'}
              </button>
            )}
          </div>
        )}

        {activeCard.recalled_at && (
          <div className="mx-5 mb-3 rounded-lg border border-[#FCD9B6] bg-[#FFF4E5] px-3 py-2.5">
            <p className="text-xs text-[#9A3412]">
              <span className="font-bold">Recalled</span> on {formatFullDateTime(activeCard.recalled_at)}.
              Acceptees still see this card with a "Recalled" tag.
            </p>
          </div>
        )}

        {activeCard.cancelled_at && (
          <div className="mx-5 mb-3 rounded-lg border border-[#FBCFCB] bg-[#FDECEC] px-3 py-2.5">
            <p className="text-xs text-[#B42318]">
              <span className="font-bold">Cancelled</span> on {formatFullDateTime(activeCard.cancelled_at)}.
              Acceptees still see this card with a "Cancelled" tag.
            </p>
          </div>
        )}

        {activeCard.archived_at && (
          <div className="mx-5 mb-3 rounded-lg border border-[#DCC9F8] bg-[#F2EBFE] px-3 py-2.5">
            <p className="text-xs text-[#6B21A8]">
              <span className="font-bold">Archived</span> on {formatFullDateTime(activeCard.archived_at)}.
              Hidden from talent feeds and the default Published list. Republish to bring it back as a manual card, or delete it permanently.
            </p>
          </div>
        )}

        {!isSecondaryView && !card.parent_card_id && !activeCard.archived_at && (
          <SecondaryCardsSection
            parentCard={card}
            secondaryCards={secondaryCards}
            onViewSecondary={onViewSecondary}
          />
        )}

        {!activeCard.archived_at && (
        <div className="mx-5 mb-4 sh-card flex items-center justify-between p-3">
          {hasSelection ? (
            <>
              <p className="text-xs font-semibold text-[#1E40AF]">A recipient has been selected for this card.</p>
              <button
                onClick={() => setConfirmAction({ kind: 'undoSelection' })}
                disabled={undoSelection.isPending}
                className="sh-btn-ghost sh-btn-ghost-sm"
              >
                Undo selection
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--color-sh-ink-muted)]">Hand-pick a partner or talent for this card.</p>
              <button
                onClick={() => setPickerOpen(true)}
                className="sh-btn-primary sh-btn-primary-sm"
              >
                Assign
              </button>
            </>
          )}
        </div>
        )}
        <div className="px-5 pb-5 space-y-6 text-sm">
          {isLoading ? (
            <p className="text-center text-xs text-[var(--color-sh-ink-faint)]">Loading…</p>
          ) : error ? (
            <p className="text-center text-xs text-red-600">Failed to load recipients.</p>
          ) : (
            <>
              <Section title="Partners">
                <Subgroup
                  label="Accepted"
                  onRemove={(id, name) => setConfirmAction({ kind: 'removePartner', id, name })}
                  isRemoving={removePartner.isPending}
                  onSelect={!hasSelection && activeCard.state === 'published' ? (id, name) => setConfirmAction({ kind: 'selectPartner', id, name }) : undefined}
                  isSelecting={selectPartner.isPending}
                  items={partnerGroups.accepted.map((p) => ({
                    key: p.id, name: p.name, user_type: p.user_type ?? null, status: p.status, responded_at: p.responded_at, assigned_manually: !!p.assigned_manually,
                    selected_at: p.selected_at ?? null, passed_over_at: p.passed_over_at ?? null,
                  }))}
                />
                <Subgroup
                  label="Rejected"
                  onRemove={(id, name) => setConfirmAction({ kind: 'removePartner', id, name })}
                  isRemoving={removePartner.isPending}
                  items={partnerGroups.rejected.map((p) => ({
                    key: p.id, name: p.name, user_type: p.user_type ?? null, status: p.status, responded_at: p.responded_at, assigned_manually: !!p.assigned_manually,
                    selected_at: null, passed_over_at: null,
                  }))}
                />
                <Subgroup
                  label="Pending"
                  onRemove={(id, name) => setConfirmAction({ kind: 'removePartner', id, name })}
                  isRemoving={removePartner.isPending}
                  onAutoAccept={
                    activeCard.distribution === 'manual' && activeCard.state === 'published'
                      ? (id, name) => setConfirmAction({ kind: 'autoAcceptPartner', id, name })
                      : undefined
                  }
                  isAutoAccepting={autoAcceptPartner.isPending}
                  items={partnerGroups.pending.map((p) => ({
                    key: p.id, name: p.name, user_type: p.user_type ?? null, status: p.status, responded_at: null, assigned_manually: !!p.assigned_manually,
                    selected_at: null, passed_over_at: null,
                  }))}
                />
              </Section>
              <Section title="Talents">
                <Subgroup
                  label="Accepted"
                  onRemove={(id, name) => setConfirmAction({ kind: 'removeTalent', id, name })}
                  isRemoving={removeTalent.isPending}
                  onSelect={!hasSelection && activeCard.state === 'published' ? (id, name) => setConfirmAction({ kind: 'selectTalent', id, name }) : undefined}
                  isSelecting={selectTalent.isPending}
                  items={talentGroups.accepted.map((t) => ({
                    key: t.external_user_id,
                    name: t.name || 'Unknown talent',
                    subtitle: t.external_user_id.slice(0, 8),
                    status: t.status,
                    responded_at: t.responded_at,
                    assigned_manually: !!t.assigned_manually,
                    selected_at: t.selected_at ?? null, passed_over_at: t.passed_over_at ?? null,
                    externalUrl: adminUrl ? `${adminUrl}/admin/users/${t.external_user_id}` : '#',
                  }))}
                />
                <Subgroup
                  label="Rejected"
                  onRemove={(id, name) => setConfirmAction({ kind: 'removeTalent', id, name })}
                  isRemoving={removeTalent.isPending}
                  items={talentGroups.rejected.map((t) => ({
                    key: t.external_user_id,
                    name: t.name || 'Unknown talent',
                    subtitle: t.external_user_id.slice(0, 8),
                    status: t.status,
                    responded_at: t.responded_at,
                    assigned_manually: !!t.assigned_manually,
                    selected_at: null, passed_over_at: null,
                    externalUrl: adminUrl ? `${adminUrl}/admin/users/${t.external_user_id}` : '#',
                  }))}
                />
                <Subgroup
                  label="Pending"
                  onRemove={(id, name) => setConfirmAction({ kind: 'removeTalent', id, name })}
                  isRemoving={removeTalent.isPending}
                  items={talentGroups.pending.map((t) => ({
                    key: t.external_user_id,
                    name: t.name || 'Unknown talent',
                    subtitle: t.external_user_id.slice(0, 8),
                    status: t.status,
                    responded_at: null,
                    assigned_manually: !!t.assigned_manually,
                    selected_at: null, passed_over_at: null,
                    externalUrl: adminUrl ? `${adminUrl}/admin/users/${t.external_user_id}` : '#',
                  }))}
                />
              </Section>
            </>
          )}
        </div>

        <div className="border-t border-[var(--color-sh-warm-border)] bg-white px-5 py-4">
          {!activeCard.archived_at ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--color-sh-ink-muted)]">
                Move this card to the Archive tab. Hidden from talent feeds; reversible.
              </p>
              <button
                onClick={() => setConfirmAction({ kind: 'archive' })}
                disabled={archiveCard.isPending}
                className="sh-btn-violet"
              >
                {archiveCard.isPending ? 'Archiving…' : 'Archive this card'}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--color-sh-ink-muted)]">
                Republish this card as a manual draft, or delete it permanently.
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setConfirmAction({ kind: 'republish' })}
                  disabled={republishCard.isPending}
                  className="sh-btn-success"
                >
                  {republishCard.isPending ? 'Republishing…' : 'Republish'}
                </button>
                <button
                  onClick={() => setConfirmAction({ kind: 'deletePermanent' })}
                  disabled={deleteCard.isPending}
                  className="sh-btn-danger"
                >
                  {deleteCard.isPending ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {pickerOpen && (
        <AssignRecipientPicker cardId={activeCardId} onClose={() => setPickerOpen(false)} />
      )}
      <ConfirmActionDialog
        confirmAction={confirmAction}
        onCancel={clearConfirm}
        acceptedPartners={partnerGroups.accepted.length}
        acceptedTalents={talentGroups.accepted.length}
        isPending={{
          removePartner: removePartner.isPending,
          removeTalent: removeTalent.isPending,
          selectPartner: selectPartner.isPending,
          selectTalent: selectTalent.isPending,
          autoAcceptPartner: autoAcceptPartner.isPending,
          undoSelection: undoSelection.isPending,
          recall: recallCard.isPending,
          cancel: cancelCard.isPending,
          archive: archiveCard.isPending,
          republish: republishCard.isPending,
          deletePermanent: deleteCard.isPending,
          broadcast: broadcastCard.isPending,
        }}
        onConfirm={(action) => {
          switch (action.kind) {
            case 'removePartner': removePartner.mutate(action.id); break;
            case 'removeTalent': removeTalent.mutate(action.id); break;
            case 'selectPartner': selectPartner.mutate(action.id); break;
            case 'selectTalent': selectTalent.mutate(action.id); break;
            case 'autoAcceptPartner': autoAcceptPartner.mutate(action.id); break;
            case 'undoSelection': undoSelection.mutate(); break;
            case 'recall': recallCard.mutate(); break;
            case 'cancel': cancelCard.mutate(); break;
            case 'archive': archiveCard.mutate(); break;
            case 'republish': republishCard.mutate(); break;
            case 'deletePermanent': deleteCard.mutate(); break;
            case 'broadcast': broadcastCard.mutate(); break;
          }
        }}
      />
    </>
  );
}

type ConfirmAction =
  | { kind: 'removePartner'; id: string; name: string }
  | { kind: 'removeTalent'; id: string; name: string }
  | { kind: 'selectPartner'; id: string; name: string }
  | { kind: 'selectTalent'; id: string; name: string }
  | { kind: 'autoAcceptPartner'; id: string; name: string }
  | { kind: 'undoSelection' }
  | { kind: 'recall' }
  | { kind: 'cancel' }
  | { kind: 'archive' }
  | { kind: 'republish' }
  | { kind: 'deletePermanent' }
  | { kind: 'broadcast' };

function ConfirmActionDialog({
  confirmAction,
  onCancel,
  onConfirm,
  acceptedPartners,
  acceptedTalents,
  isPending,
}: {
  confirmAction: ConfirmAction | null;
  onCancel: () => void;
  onConfirm: (action: ConfirmAction) => void;
  acceptedPartners: number;
  acceptedTalents: number;
  isPending: Record<ConfirmAction['kind'], boolean>;
}) {
  if (!confirmAction) return null;

  const k = confirmAction.kind;
  const isTerminalKind = k === 'recall' || k === 'cancel';
  const hasAcceptances = isTerminalKind && (acceptedPartners + acceptedTalents) > 0;
  const total = acceptedPartners + acceptedTalents;
  const terminalVerb = k === 'cancel' ? 'Cancelling' : 'Recalling';
  const terminalTag = k === 'cancel' ? 'Cancelled' : 'Recalled';

  const DIALOG_CONFIG: Record<ConfirmAction['kind'], { title: string; description: string; confirmLabel: string; pendingLabel: string; variant: 'default' | 'danger' | 'warning' }> = {
    removePartner: {
      title: 'Remove partner?',
      description: `Remove ${'name' in confirmAction ? confirmAction.name : ''} from this card? They'll stop seeing it in their opportunities.`,
      confirmLabel: 'Remove',
      pendingLabel: 'Removing…',
      variant: 'danger',
    },
    removeTalent: {
      title: 'Remove talent?',
      description: `Remove ${'name' in confirmAction ? confirmAction.name : ''} from this card? They'll stop seeing it in their subscription tab.`,
      confirmLabel: 'Remove',
      pendingLabel: 'Removing…',
      variant: 'danger',
    },
    selectPartner: {
      title: 'Select partner?',
      description: `Select ${'name' in confirmAction ? confirmAction.name : ''} for this card? Other acceptees will be passed over and the card will close.`,
      confirmLabel: 'Select',
      pendingLabel: 'Selecting…',
      variant: 'warning',
    },
    selectTalent: {
      title: 'Select talent?',
      description: `Select ${'name' in confirmAction ? confirmAction.name : ''} for this card? Other acceptees will be passed over and the card will close.`,
      confirmLabel: 'Select',
      pendingLabel: 'Selecting…',
      variant: 'warning',
    },
    autoAcceptPartner: {
      title: 'Auto-accept partner-employee?',
      description: `Accept this card on behalf of ${'name' in confirmAction ? confirmAction.name : ''}. They'll skip the manual accept step and become visible to the business user immediately.`,
      confirmLabel: 'Auto-accept',
      pendingLabel: 'Accepting…',
      variant: 'default',
    },
    undoSelection: {
      title: 'Undo selection?',
      description: 'The card will reopen as published.',
      confirmLabel: 'Undo',
      pendingLabel: 'Undoing…',
      variant: 'warning',
    },
    recall: {
      title: hasAcceptances ? 'Recall card with acceptances?' : 'Recall this card?',
      description: hasAcceptances
        ? ''
        : 'Pending recipients will stop seeing it.',
      confirmLabel: hasAcceptances ? 'Recall anyway' : 'Recall',
      pendingLabel: 'Recalling…',
      variant: 'warning',
    },
    cancel: {
      title: hasAcceptances ? 'Cancel card with acceptances?' : 'Cancel this card?',
      description: hasAcceptances
        ? ''
        : 'Pending recipients will stop seeing it. This is terminal — the card cannot be re-published.',
      confirmLabel: hasAcceptances ? 'Cancel anyway' : 'Cancel',
      pendingLabel: 'Cancelling…',
      variant: 'danger',
    },
    archive: {
      title: 'Archive this card?',
      description: 'Hides the card from talents and from the default Published list. You can republish it as a manual draft or delete it from the Archive tab.',
      confirmLabel: 'Archive',
      pendingLabel: 'Archiving…',
      variant: 'warning',
    },
    republish: {
      title: 'Republish this card?',
      description: 'Brings the card back as state="published" with distribution="manual". All previous accept/reject/pending recipients are cleared. You will need to broadcast or hand-pick recipients.',
      confirmLabel: 'Republish',
      pendingLabel: 'Republishing…',
      variant: 'warning',
    },
    deletePermanent: {
      title: 'Delete this card permanently?',
      description: 'This cannot be undone. Recipients and any secondary cards will be deleted with it.',
      confirmLabel: 'Delete forever',
      pendingLabel: 'Deleting…',
      variant: 'danger',
    },
    broadcast: {
      title: 'Broadcast this card?',
      description: 'This will broadcast the card to all matching partners and talents based on the targeting criteria.',
      confirmLabel: 'Broadcast',
      pendingLabel: 'Broadcasting…',
      variant: 'default',
    },
  };

  const cfg = DIALOG_CONFIG[k];

  return (
    <ConfirmDialog
      open
      title={cfg.title}
      description={cfg.description || undefined}
      confirmLabel={cfg.confirmLabel}
      pendingLabel={cfg.pendingLabel}
      variant={cfg.variant}
      isPending={isPending[k]}
      onCancel={onCancel}
      onConfirm={() => onConfirm(confirmAction)}
    >
      {hasAcceptances && (
        <>
          <p className="mt-2 text-sm text-[var(--color-sh-ink-muted)]">
            This card has{' '}
            <span className="font-bold text-[var(--color-sh-ink)]">
              {total} {total === 1 ? 'acceptance' : 'acceptances'}
            </span>{' '}
            ({acceptedPartners} partner{acceptedPartners === 1 ? '' : 's'}, {acceptedTalents} talent
            {acceptedTalents === 1 ? '' : 's'}). {terminalVerb} will:
          </p>
          <ul className="mt-2 space-y-1 text-xs text-[var(--color-sh-ink-muted)]">
            <li>• Drop pending recipients (they stop seeing the card).</li>
            <li>• Keep acceptees in their feed with a "{terminalTag}" tag.</li>
            <li>• Mark the card terminal — no re-publish.</li>
          </ul>
        </>
      )}
    </ConfirmDialog>
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
      showToast(err?.response?.data?.error || err.message || 'Failed to create secondary card', 'error'),
  });

  function handleCreate() {
    const priceVal = price.trim() ? parseInt(price, 10) : null;
    if (priceVal !== null && (isNaN(priceVal) || priceVal < 0)) {
      showToast('Price must be a positive number', 'error');
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
    <div className="px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="sh-section-heading">
          Secondary Cards ({secondaryCards.length})
        </h4>
        {parentCard.state === 'published' && (
          <button
            onClick={() => setFormOpen(!formOpen)}
            className="sh-btn-ghost sh-btn-ghost-sm"
          >
            {formOpen ? 'Cancel' : 'Create'}
          </button>
        )}
      </div>

      {formOpen && (
        <div className="sh-card p-4 space-y-3" style={{ background: 'var(--color-sh-lime-soft)', borderColor: 'var(--color-sh-warm-border)' }}>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--color-sh-ink-muted)] w-24 shrink-0">Partner price</label>
            <div className="flex items-center gap-1 flex-1">
              {priceCurrency && <span className="text-xs text-[var(--color-sh-ink-faint)]">{priceCurrency}</span>}
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Same as primary"
                className="sh-input"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--color-sh-ink-muted)] w-24 shrink-0">Distribution</label>
            <select
              value={distribution}
              onChange={(e) => setDistribution(e.target.value as 'broadcast' | 'manual')}
              className="sh-input"
            >
              <option value="manual">Publish (manual)</option>
              <option value="broadcast">Broadcast</option>
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={createSecondary.isPending}
            className="sh-btn-primary sh-btn-primary-sm w-full"
          >
            {createSecondary.isPending ? 'Creating…' : 'Create & Publish'}
          </button>
        </div>
      )}

      {secondaryCards.length === 0 && !formOpen && (
        <p className="text-xs text-[var(--color-sh-ink-faint)]">No secondary cards yet.</p>
      )}

      {secondaryCards.length > 0 && (
        <ul className="space-y-2">
          {secondaryCards.map((sc) => {
            const isRecalled = !!sc.recalled_at;
            const stateColor = sc.state === 'published' ? '#10B981' : isRecalled ? '#EA580C' : '#6B7280';
            const stateLabel = sc.state === 'published' ? 'Active' : isRecalled ? 'Recalled' : 'Closed';
            const distLabel = sc.distribution === 'manual' ? 'Soft Published' : 'Broadcast';
            const partners = sc.recipient_counts?.partners ?? { pending: 0, accepted: 0, rejected: 0 };
            const talents = sc.recipient_counts?.talents ?? { accepted: 0, rejected: 0 };
            return (
              <li key={sc.id}>
                <button
                  onClick={() => onViewSecondary(sc.id)}
                  className="sh-card sh-card-interactive flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="sh-status-pill"
                        style={{ backgroundColor: `${stateColor}1F`, color: stateColor }}
                      >
                        <span className="h-1 w-1 rounded-full" style={{ backgroundColor: stateColor }} />
                        {stateLabel}
                      </span>
                      <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
                        {distLabel}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-sh-ink)]">
                      {sc.partner_price_override != null
                        ? `${priceCurrency} ${sc.partner_price_override.toLocaleString()}`
                        : 'Same price as primary'}
                    </p>
                    <p className="text-[10px] text-[var(--color-sh-ink-faint)]">
                      Published {formatRelative(sc.published_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-sh-cream)] border border-[var(--color-sh-warm-border)] px-1.5 py-0.5 text-[10px] font-medium">
                      <span className="text-emerald-700 font-semibold">{partners.accepted + talents.accepted}&#10003;</span>
                      <span className="text-red-600 font-semibold">{partners.rejected + talents.rejected}&#10007;</span>
                      <span className="text-amber-700 font-semibold">{partners.pending}&#9203;</span>
                    </span>
                    <svg className="h-3.5 w-3.5 text-[var(--color-sh-ink-faint)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
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
  const distLabel = activeCard.distribution === 'manual' ? 'Soft Published' : 'Broadcast';
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
    <div className="px-5 py-5 space-y-5 text-sm">
      {isSecondaryView && (
        <div className="rounded-lg bg-[var(--color-sh-lime-soft)] border border-[var(--color-sh-warm-border)] px-3 py-2">
          <p className="text-[11px] font-semibold text-[var(--color-sh-ink)]">
            Secondary card — content inherited from primary
          </p>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="sh-status-pill"
            style={{ backgroundColor: `${stateColor}1F`, color: stateColor }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
            {stateLabel}
          </span>
          <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>{distLabel}</span>
          {sourceBadge && (
            <span className="sh-status-pill" style={{ backgroundColor: '#F2EBFE', color: '#6B21A8' }}>{sourceBadge}</span>
          )}
        </div>
        {(planLabel || fallbackPlanLabel) && (
          <p className="text-xs text-[var(--color-sh-ink-muted)]">{planLabel || fallbackPlanLabel}</p>
        )}
        <p className="text-xs text-[var(--color-sh-ink-muted)]">
          Published {formatFullDateTime(activeCard.published_at || card.published_at)}
          {publisher && (
            <> by {publisher.display_name || publisher.email || publisher.id.slice(0, 8)}</>
          )}
        </p>
        {card.publish_targets && card.publish_targets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-[var(--color-sh-ink-faint)]">Published to:</span>
            {card.publish_targets.map((t) => (
              <span key={t} className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </span>
            ))}
          </div>
        )}
      </div>

      <DetailSection title="Working & business">
        <DetailRow label="Working days" value={card.working_days?.length ? card.working_days.join(' · ') : EMPTY} />
        <DetailRow label="Brand" value={card.brand_name || EMPTY} />
        <DetailRow label="Nature" value={card.business_nature || EMPTY} />
        <DetailRow label="Notes" value={card.notes || EMPTY} multiline />
      </DetailSection>

      <DetailSection title="Customer">
        <DetailRow label="Contact Person" value={card.customer_name || EMPTY} />
        <DetailRow label="Email" value={card.customer_email || EMPTY} />
        <DetailRow label="Phone" value={card.customer_phone || EMPTY} />
        <DetailRow label="Location" value={card.customer_location || EMPTY} />
      </DetailSection>

      <DetailSection title="Targeting">
        <DetailRow label="Tiers" value={card.target_tiers?.length ? card.target_tiers.join(' · ') : EMPTY} />
        <DetailRow
          label="Min experience"
          value={card.min_experience_years > 0 ? `${card.min_experience_years}+ years` : 'Any'}
        />
        <DetailRow label="Languages" value={card.target_languages?.length ? card.target_languages.join(' · ') : EMPTY} />
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
      </DetailSection>

      <DetailSection title="Deliverables">
        {((card.plan_default_deliverables?.length || 0) === 0 && (card.custom_deliverables?.length || 0) === 0) ? (
          <DetailRow label="Deliverables" value={EMPTY} />
        ) : (
          <>
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
          </>
        )}
      </DetailSection>

      <DetailSection title="Pricing">
        <DetailRow
          label="Plan price"
          value={planPrice ? `${priceCurrency} ${planPrice.price.toLocaleString()}` : EMPTY}
        />
        <DetailRow
          label="Proposed price"
          value={card.proposed_price ? `₹${card.proposed_price.toLocaleString()}/mo` : EMPTY}
        />
        <DetailRow
          label="Margin"
          value={card.markup ? `₹${card.markup.toLocaleString()}/mo` : EMPTY}
        />
        <DetailRow
          label="Partner price (computed)"
          value={
            card.proposed_price
              ? `₹${Math.max(0, card.proposed_price - (card.markup || 0)).toLocaleString()}/mo`
              : EMPTY
          }
        />
        <DetailRow
          label="Partner price override"
          value={
            activeCard.partner_price_override != null
              ? `${priceCurrency || '₹'} ${activeCard.partner_price_override.toLocaleString()}`
              : isSecondaryView
                ? 'Same as primary'
                : card.partner_price_override != null
                  ? `${priceCurrency || '₹'} ${card.partner_price_override.toLocaleString()}`
                  : EMPTY
          }
        />
      </DetailSection>

      <DetailSection title="Lifecycle">
        <DetailRow label="Source" value={sourceLabel(card.source)} />
        <DetailRow
          label="Subscription request #"
          value={card.subscription_request_id != null ? String(card.subscription_request_id) : EMPTY}
        />
        <DetailRow label="Assigned at" value={card.assigned_at ? formatFullDateTime(card.assigned_at) : EMPTY} />
        <DetailRow label="Recalled at" value={card.recalled_at ? formatFullDateTime(card.recalled_at) : EMPTY} />
        <DetailRow label="Cancelled at" value={card.cancelled_at ? formatFullDateTime(card.cancelled_at) : EMPTY} />
        <DetailRow label="Closed at" value={card.closed_at ? formatFullDateTime(card.closed_at) : EMPTY} />
        <DetailRow
          label="Selected recipient"
          value={
            card.selected_recipient_type
              ? `${card.selected_recipient_type}${card.selected_recipient_id ? ` · ${card.selected_recipient_id.slice(0, 8)}` : ''}`
              : EMPTY
          }
        />
        <DetailRow label="Secondary cards" value={card.secondary_card_count != null ? String(card.secondary_card_count) : EMPTY} />
      </DetailSection>

      <DetailSection title="SquadHire delivery">
        <DetailRow label="Status" value={squadhireStatusLabel(card)} />
        <DetailRow
          label="Last synced"
          value={card.squadhire_synced_at ? formatFullDateTime(card.squadhire_synced_at) : EMPTY}
        />
        <DetailRow
          label="Sync attempts"
          value={card.squadhire_sync_attempts != null ? String(card.squadhire_sync_attempts) : EMPTY}
        />
        <DetailRow label="Last error" value={card.squadhire_sync_last_error || EMPTY} multiline />
        <DetailRow
          label="Recipient count"
          value={card.squadhire_recipient_count != null ? String(card.squadhire_recipient_count) : EMPTY}
        />
      </DetailSection>

      <DetailSection title="Metadata">
        <DetailRow label="Card ID" value={card.id} />
        <DetailRow label="Created" value={card.created_at ? formatFullDateTime(card.created_at) : EMPTY} />
        <DetailRow label="Updated" value={card.updated_at ? formatFullDateTime(card.updated_at) : EMPTY} />
      </DetailSection>
    </div>
  );
}

const EMPTY = '—';

function sourceLabel(source: PublishedCard['source']): string {
  if (source === 'request') return 'From request';
  if (source === 'custom') return 'Custom';
  if (source === 'submission') return 'From submission';
  return EMPTY;
}

function squadhireStatusLabel(card: PublishedCard): string {
  if (card.squadhire_synced_at) return 'Delivered';
  const hasCategories = (card.squadhire_category_ids?.length || 0) > 0;
  if (!hasCategories) return 'Skipped (no categories)';
  if (card.squadhire_sync_last_error) return 'Error';
  return 'Pending';
}

function formatDeliverable(d: { kind: 'hours' | 'item'; per_day: number; per_week: number; per_month: number }): string {
  const day = Number(d.per_day) || 0;
  const week = Number(d.per_week) || 0;
  const month = Number(d.per_month) || 0;
  if (day === 0 && week === 0 && month === 0) return '—';
  if (d.kind === 'hours') {
    return `${day} hrs/day · ${week} hrs/week · ${month} hrs/month`;
  }
  return `${day}/day · ${week}/week · ${month}/month`;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sh-card p-4 space-y-2">
      <h4 className="sh-section-heading">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, multiline, strikethrough }: { label: string; value: string; multiline?: boolean; strikethrough?: boolean }) {
  return (
    <div className={`flex gap-3 ${multiline ? 'flex-col' : 'justify-between'}`}>
      <span className={`text-xs text-[var(--color-sh-ink-faint)] ${strikethrough ? 'line-through' : ''}`}>{label}</span>
      <span className={`text-xs ${strikethrough ? 'text-[var(--color-sh-ink-faint)] line-through' : 'text-[var(--color-sh-ink)]'} ${multiline ? '' : 'text-right'}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="sh-section-heading">{title}</h4>
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
  onAutoAccept,
  isAutoAccepting,
}: {
  label: 'Accepted' | 'Rejected' | 'Pending';
  items: { key: string; name: string; subtitle?: string | null; user_type?: 'partner' | 'partner_employee' | null; status: 'accepted' | 'rejected' | 'pending'; responded_at: string | null; assigned_manually?: boolean; selected_at?: string | null; passed_over_at?: string | null; externalUrl?: string }[];
  onRemove?: (key: string, name: string) => void;
  isRemoving?: boolean;
  onSelect?: (key: string, name: string) => void;
  isSelecting?: boolean;
  onAutoAccept?: (key: string, name: string) => void;
  isAutoAccepting?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-[var(--color-sh-ink-muted)]">{label} (0)</p>
        <p className="text-xs text-[var(--color-sh-ink-faint)]">None.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-[var(--color-sh-ink-muted)]">
        {label} ({items.length})
      </p>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.key} className="group sh-card flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1 truncate">
              <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">{it.name}</p>
              {it.subtitle && (
                <p className="truncate text-[11px] font-mono text-[var(--color-sh-ink-faint)]">{it.subtitle}</p>
              )}
              {it.responded_at && (
                <p className="text-[11px] text-[var(--color-sh-ink-faint)]">{formatRelative(it.responded_at)}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {it.externalUrl && (
                (() => {
                  const isLinked = it.externalUrl !== '#';
                  return (
                    <a
                      href={it.externalUrl}
                      target={isLinked ? '_blank' : undefined}
                      rel="noopener noreferrer"
                      title={isLinked ? 'View profile in SquadHire' : 'SquadHire admin URL not configured'}
                      className={`rounded-md p-1 transition ${isLinked ? 'text-[var(--color-sh-ink-faint)] hover:bg-[var(--color-sh-cream)] hover:text-[var(--color-sh-ink)]' : 'text-[var(--color-sh-ink-faint)] opacity-40 cursor-not-allowed'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isLinked) e.preventDefault();
                      }}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                  );
                })()
              )}
              {it.selected_at && (
                <span className="sh-status-pill" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>
                  Selected
                </span>
              )}
              {it.passed_over_at && !it.selected_at && (
                <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
                  Not selected
                </span>
              )}
              {it.user_type === 'partner_employee' && (
                <span
                  className="sh-status-pill"
                  style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}
                  title="Internal partner-employee user"
                >
                  Employee
                </span>
              )}
              {it.assigned_manually && (
                <span
                  className="sh-status-pill"
                  style={{ backgroundColor: '#EEF2F6', color: '#475569' }}
                  title="Hand-picked by an admin (not auto-broadcast)"
                >
                  Manual
                </span>
              )}
              {!it.selected_at && !it.passed_over_at && (
                <span className="sh-status-pill" style={{ backgroundColor: STATUS_CHIP[it.status].bg, color: STATUS_CHIP[it.status].color }}>
                  {it.status}
                </span>
              )}
              {onAutoAccept && it.status === 'pending' && it.user_type === 'partner_employee' && !it.selected_at && !it.passed_over_at && (
                <button
                  type="button"
                  disabled={isAutoAccepting}
                  onClick={() => onAutoAccept(it.key, it.name)}
                  title={`Accept on behalf of ${it.name}`}
                  className="sh-btn-success opacity-0 group-hover:opacity-100 transition"
                >
                  Auto-accept
                </button>
              )}
              {onSelect && !it.selected_at && !it.passed_over_at && (
                <button
                  type="button"
                  disabled={isSelecting}
                  onClick={() => onSelect(it.key, it.name)}
                  title={`Select ${it.name}`}
                  className="sh-btn-info opacity-0 group-hover:opacity-100 transition"
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
                  className="rounded-md p-1 text-[var(--color-sh-ink-faint)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--color-sh-cream)] hover:text-red-600 disabled:opacity-30"
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
