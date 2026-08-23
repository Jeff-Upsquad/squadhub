'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useSquadhireConfig } from '@/hooks/useSquadhireConfig';
import AssignRecipientPicker from './AssignRecipientPicker';
import UpgradeDowngradeModal from './UpgradeDowngradeModal';
import ConfirmDialog from '@/components/ConfirmDialog';
import CardCodeChip from '@/components/CardCodeChip';
import { showToast } from '@/components/Toast';
import { resolveFinalizedPrice, resolvePlanMargin, resolvePartnerPrice } from '@squadhub/shared';
import type { AdminSubscriptionCard } from './AdminSubscriptionCards';

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

export default function AdminSubscriptionCardRecipientsPanel({
  card,
  title,
  onClose,
}: {
  card: AdminSubscriptionCard;
  title: string;
  onClose: () => void;
}) {
  const [viewingSecondaryId, setViewingSecondaryId] = useState<string | null>(null);

  const { data: secondaryCards } = useQuery({
    queryKey: ['admin-secondary-cards', card.id],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${card.id}/secondary-cards`).then((r) => r.data?.data as AdminSubscriptionCard[]),
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
        <div className="flex items-center justify-between border-b border-[var(--color-sh-warm-border)] bg-surface px-5 py-4">
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
  card: AdminSubscriptionCard;
  activeCard: AdminSubscriptionCard;
  activeCardId: string;
  isSecondaryView: boolean;
  secondaryCards: AdminSubscriptionCard[];
  onViewSecondary: (id: string | null) => void;
  onClose: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const qc = useQueryClient();
  const { adminUrl, configured: shConfigured } = useSquadhireConfig();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-card-recipients', activeCardId],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${activeCardId}/recipients`).then((r) => r.data?.data as RecipientsResponse),
  });

  // Former assignees gate the in-place plan/talent change on a reopened Published
  // card (a card that came from a prior assignment — Repost / resume / republish).
  const { data: historyRes } = useQuery({
    queryKey: ['admin-card-assignment-history', activeCardId],
    queryFn: () =>
      api
        .get(`/admin/subscription-cards/${activeCardId}/assignment-history`)
        .then((r) => r.data?.data as { previous: unknown | null; past: unknown[] }),
  });
  const hasFormerAssignees = !!historyRes?.previous || (historyRes?.past?.length ?? 0) > 0;

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
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
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
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
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
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
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
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
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
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
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
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      if (isSecondaryView) onViewSecondary(null);
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to cancel card', 'error');
      clearConfirm();
    },
  });

  // Sales outcome tag: files this card under the pipeline's "Deal Lost" tab
  // instead of Cancelled. Marking a live card lost closes it through the same
  // server machinery as Cancel; undo clears the flag so a closed card falls
  // back to Cancelled.
  const dealLost = useMutation({
    mutationFn: (lost: boolean) =>
      api.post(`/admin/subscription-cards/${activeCardId}/deal-lost`, { lost }),
    onSuccess: (_res, lost) => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      showToast(lost ? 'Marked as deal lost — the card moved to the Deal Lost tab.' : 'Deal lost cleared — the card moved back to Cancelled.', 'success');
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to update deal outcome', 'error');
      clearConfirm();
    },
  });

  // Resume a paused subscription by reopening it to Published (no broadcast yet):
  // the previous talent is released and shown as a former assignee, and the
  // matching pool becomes available so the admin can Broadcast + re-select.
  const resumeReopen = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/resume`, { mode: 'reopen' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-card-squadhire-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      showToast('Resumed — moved to Published. Broadcast to the previous talent or all matching, then select & assign.', 'success');
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to resume subscription', 'error');
      clearConfirm();
    },
  });

  // Pause a live assignment (change-assignee flow: Pause → Resume → Published).
  const pause = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/pause`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      showToast('Paused — billing stopped. Resume from the Paused tab to re-broadcast and change the assignee.', 'success');
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to pause subscription', 'error');
      clearConfirm();
    },
  });

  // Reopened, re-published card: offer to the former assignee, or broadcast wide.
  const offerPreviousTalent = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/offer-previous-talent`),
    onSuccess: (r: any) => {
      const warning = r?.data?.warning as string | undefined;
      if (warning) showToast(warning, 'error');
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-card-squadhire-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      if (!warning) showToast('Offer sent to the previous talent — awaiting their accept.', 'success');
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to offer to previous talent', 'error');
      clearConfirm();
    },
  });
  const rebroadcastAll = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/rebroadcast`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-card-squadhire-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      showToast('Broadcast sent — matching talents are being invited.', 'success');
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to broadcast', 'error');
      clearConfirm();
    },
  });

  const archiveCard = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/archive`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
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

  const reinstateCard = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/reinstate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      if (isSecondaryView) onViewSecondary(null);
      clearConfirm();
      showToast('Card reinstated to its previous state.', 'success');
      onClose();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to reinstate card', 'error');
      clearConfirm();
    },
  });

  const republishCard = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/republish`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
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
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      clearConfirm();
      showToast('Card moved to Trash.', 'success');
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
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to broadcast card', 'error');
      clearConfirm();
    },
  });

  // The unified "Broadcast" action — sends the staged recipient list. Releases
  // staged partners and delivers to talents: all matching for a Published card,
  // only the hand-picked queued ones for a Soft-published card.
  const broadcastNow = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${activeCardId}/broadcast-now`),
    onSuccess: (res: any) => {
      const d = res?.data ?? {};
      const parts: string[] = [];
      if (typeof d.partners_released === 'number' && d.partners_released > 0) {
        parts.push(`${d.partners_released} partner${d.partners_released === 1 ? '' : 's'}`);
      }
      if (d.talents?.mode === 'manual' && typeof d.talents.notified === 'number') {
        parts.push(`${d.talents.notified} talent${d.talents.notified === 1 ? '' : 's'}`);
      } else if (d.talents?.mode === 'broadcast') {
        parts.push('matching talents on SquadHire');
      }
      showToast(parts.length ? `Broadcast sent — ${parts.join(' + ')} notified.` : 'Broadcast sent.', 'success');
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', activeCardId] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-secondary-cards', card.id] });
      clearConfirm();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to broadcast', 'error');
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
              onClick={() => setConfirmAction({ kind: 'broadcastNow' })}
              disabled={broadcastNow.isPending}
              className="sh-btn-primary sh-btn-primary-sm"
              title={
                activeCard.distribution === 'manual'
                  ? 'Send the card to the talents/partners you hand-picked'
                  : 'Release the matched list — send to all matching partners and talents'
              }
            >
              {broadcastNow.isPending ? 'Broadcasting…' : 'Broadcast'}
            </button>
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
            <button
              onClick={() => setConfirmAction({ kind: 'dealLost' })}
              disabled={dealLost.isPending}
              className="sh-btn-danger"
              title="Close this card as a lost deal — files it under the Deal Lost tab instead of Cancelled"
            >
              {dealLost.isPending ? 'Marking…' : 'Mark as deal lost'}
            </button>
            {activeCard.distribution === 'manual' && (
              <button
                onClick={() => setConfirmAction({ kind: 'broadcast' })}
                disabled={broadcastCard.isPending}
                className="sh-btn-ghost sh-btn-ghost-sm"
                title="Override soft-publish: switch to broadcast and auto-match everyone that fits the targeting"
              >
                {broadcastCard.isPending ? 'Switching…' : 'Send to all matching'}
              </button>
            )}
            {/* Reopened (Resumed/Reposted) module in Published — offer to the
                former assignee, or broadcast to the whole matching pool. */}
            {hasFormerAssignees && (
              <>
                <button
                  onClick={() => setConfirmAction({ kind: 'offerPrevious' })}
                  disabled={offerPreviousTalent.isPending || rebroadcastAll.isPending}
                  className="sh-btn-ghost sh-btn-ghost-sm"
                  title="Send an offer to the card's most-recent former assignee"
                >
                  {offerPreviousTalent.isPending ? 'Offering…' : 'Broadcast to previous talent'}
                </button>
                <button
                  onClick={() => setConfirmAction({ kind: 'rebroadcastAll' })}
                  disabled={offerPreviousTalent.isPending || rebroadcastAll.isPending}
                  className="sh-btn-ghost sh-btn-ghost-sm"
                  title="Invite the full matching pool"
                >
                  {rebroadcastAll.isPending ? 'Broadcasting…' : 'Broadcast to all matching'}
                </button>
              </>
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

        {/* Sales outcome: mark a closed (or still-live) card as lost, or undo
            the tag to file it back under Cancelled. */}
        {!activeCard.archived_at && (activeCard.state === 'published' || activeCard.state === 'assigned' || activeCard.state === 'closed') && (
          <div className="mx-5 mb-3">
            {activeCard.deal_lost_at ? (
              <div className="rounded-lg border border-[#FBCFCB] bg-[#FDECEC] px-3 py-2.5">
                <p className="text-xs text-[#B42318]">
                  <span className="font-bold">Deal Lost</span> — marked on {formatFullDateTime(activeCard.deal_lost_at)}.
                  Filed under the Deal Lost tab instead of Cancelled.
                </p>
                <button
                  onClick={() => setConfirmAction({ kind: 'undoDealLost' })}
                  disabled={dealLost.isPending}
                  className="sh-btn-ghost sh-btn-ghost-sm mt-2"
                >
                  {dealLost.isPending ? 'Undoing…' : 'Undo deal lost'}
                </button>
              </div>
            ) : activeCard.state === 'closed' ? (
              <button
                onClick={() => setConfirmAction({ kind: 'dealLost' })}
                disabled={dealLost.isPending}
                className="sh-btn-danger"
                title="File this cancelled card under the Deal Lost tab instead"
              >
                {dealLost.isPending ? 'Marking…' : 'Mark as deal lost'}
              </button>
            ) : null}
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
              <p className="text-xs font-semibold text-accent-strong">
                {activeCard.paused_at ? 'This subscription is paused.' : 'A recipient has been selected for this card.'}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {activeCard.paused_at ? (
                  <>
                    <button
                      onClick={() => setConfirmAction({ kind: 'resume' })}
                      disabled={resumeReopen.isPending || cancelCard.isPending || pause.isPending}
                      className="sh-btn-primary sh-btn-primary-sm"
                      title="Reopen this paused subscription to Published, then broadcast (previous talent or all) and re-assign"
                    >
                      {resumeReopen.isPending ? 'Resuming…' : 'Resume'}
                    </button>
                    <button
                      onClick={() => setUpgradeOpen(true)}
                      disabled={resumeReopen.isPending || cancelCard.isPending}
                      className="sh-btn-ghost sh-btn-ghost-sm"
                      title="Upgrade or downgrade the plan — soft-cancels this card and opens a new one in New Deals on the new plan"
                    >
                      Upgrade / downgrade
                    </button>
                    <button
                      onClick={() => setConfirmAction({ kind: 'cancel' })}
                      disabled={resumeReopen.isPending || cancelCard.isPending}
                      className="sh-btn-danger"
                    >
                      {cancelCard.isPending ? 'Cancelling…' : 'Cancel subscription'}
                    </button>
                  </>
                ) : (
                  <>
                    {activeCard.state === 'assigned' && (
                      <>
                        <button
                          onClick={() => setConfirmAction({ kind: 'pause' })}
                          disabled={pause.isPending || cancelCard.isPending || undoSelection.isPending}
                          className="sh-btn-primary sh-btn-primary-sm"
                          title="Pause billing and hold the talent. Resume later to re-broadcast and change the assignee."
                        >
                          {pause.isPending ? 'Pausing…' : 'Pause'}
                        </button>
                        <button
                          onClick={() => setUpgradeOpen(true)}
                          disabled={pause.isPending || cancelCard.isPending}
                          className="sh-btn-ghost sh-btn-ghost-sm"
                          title="Upgrade or downgrade the plan — soft-cancels this card and opens a new one in New Deals on the new plan"
                        >
                          Upgrade / downgrade
                        </button>
                        <button
                          onClick={() => setConfirmAction({ kind: 'cancel' })}
                          disabled={cancelCard.isPending || undoSelection.isPending || pause.isPending}
                          className="sh-btn-danger"
                        >
                          {cancelCard.isPending ? 'Cancelling…' : 'Cancel the module'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setConfirmAction({ kind: 'undoSelection' })}
                      disabled={undoSelection.isPending}
                      className="sh-btn-ghost sh-btn-ghost-sm"
                    >
                      Undo selection
                    </button>
                  </>
                )}
              </div>
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

        <div className="border-t border-[var(--color-sh-warm-border)] bg-surface px-5 py-4">
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
                Reinstate to its previous state, republish as a fresh manual draft, or delete permanently.
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setConfirmAction({ kind: 'reinstate' })}
                  disabled={reinstateCard.isPending}
                  className="sh-btn-primary"
                >
                  {reinstateCard.isPending ? 'Reinstating…' : 'Reinstate'}
                </button>
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
                  {deleteCard.isPending ? 'Moving…' : 'Move to Trash'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {pickerOpen && (
        <AssignRecipientPicker cardId={activeCardId} onClose={() => setPickerOpen(false)} />
      )}
      {upgradeOpen && (
        <UpgradeDowngradeModal cardId={activeCardId} onClose={() => setUpgradeOpen(false)} />
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
          dealLost: dealLost.isPending && dealLost.variables !== false,
          undoDealLost: dealLost.isPending && dealLost.variables === false,
          resume: resumeReopen.isPending,
          pause: pause.isPending,
          offerPrevious: offerPreviousTalent.isPending,
          rebroadcastAll: rebroadcastAll.isPending,
          archive: archiveCard.isPending,
          reinstate: reinstateCard.isPending,
          republish: republishCard.isPending,
          deletePermanent: deleteCard.isPending,
          broadcast: broadcastCard.isPending,
          broadcastNow: broadcastNow.isPending,
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
            case 'dealLost': dealLost.mutate(true); break;
            case 'undoDealLost': dealLost.mutate(false); break;
            case 'resume': resumeReopen.mutate(); break;
            case 'pause': pause.mutate(); break;
            case 'offerPrevious': offerPreviousTalent.mutate(); break;
            case 'rebroadcastAll': rebroadcastAll.mutate(); break;
            case 'archive': archiveCard.mutate(); break;
            case 'reinstate': reinstateCard.mutate(); break;
            case 'republish': republishCard.mutate(); break;
            case 'deletePermanent': deleteCard.mutate(); break;
            case 'broadcast': broadcastCard.mutate(); break;
            case 'broadcastNow': broadcastNow.mutate(); break;
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
  | { kind: 'dealLost' }
  | { kind: 'undoDealLost' }
  | { kind: 'resume' }
  | { kind: 'pause' }
  | { kind: 'offerPrevious' }
  | { kind: 'rebroadcastAll' }
  | { kind: 'archive' }
  | { kind: 'reinstate' }
  | { kind: 'republish' }
  | { kind: 'deletePermanent' }
  | { kind: 'broadcast' }
  | { kind: 'broadcastNow' };

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
    dealLost: {
      title: 'Mark this deal as lost?',
      description: 'A live card closes like a cancel — billing stops, pending recipients are dropped and the talent is released — but it files under Deal Lost instead of Cancelled.',
      confirmLabel: 'Mark as deal lost',
      pendingLabel: 'Marking…',
      variant: 'danger',
    },
    undoDealLost: {
      title: 'Undo deal lost?',
      description: 'Clears the lost tag. A closed card files back under Cancelled — nothing is resurrected.',
      confirmLabel: 'Undo',
      pendingLabel: 'Undoing…',
      variant: 'default',
    },
    resume: {
      title: 'Resume this subscription?',
      description: 'The card reopens to Published — the previous talent is released and shown as a former assignee, and the matching pool is refreshed. Broadcast to the previous talent or all matching, then select & assign (assign date = new start date).',
      confirmLabel: 'Resume',
      pendingLabel: 'Resuming…',
      variant: 'default',
    },
    pause: {
      title: 'Pause this subscription?',
      description: 'Billing stops and the talent is held. To CHANGE the assignee, Resume it from the Paused tab — it reopens to Published where you broadcast (previous talent or all) and select someone new.',
      confirmLabel: 'Pause',
      pendingLabel: 'Pausing…',
      variant: 'warning',
    },
    offerPrevious: {
      title: 'Broadcast to the previous talent?',
      description: 'Sends a fresh offer to the most-recent former assignee — they must accept before billing resumes.',
      confirmLabel: 'Send offer',
      pendingLabel: 'Offering…',
      variant: 'default',
    },
    rebroadcastAll: {
      title: 'Broadcast to all matching?',
      description: 'Invites the full matching talent pool — not just the previous talent.',
      confirmLabel: 'Broadcast',
      pendingLabel: 'Broadcasting…',
      variant: 'default',
    },
    archive: {
      title: 'Archive this card?',
      description: 'Hides the card from talents and from the default Published list. You can reinstate it to this exact state, republish it fresh, or delete it — all from the Archive tab.',
      confirmLabel: 'Archive',
      pendingLabel: 'Archiving…',
      variant: 'warning',
    },
    reinstate: {
      title: 'Reinstate this card?',
      description: 'Un-archives the card and restores its exact previous state — same status, recipients, and history. Nothing is reset.',
      confirmLabel: 'Reinstate',
      pendingLabel: 'Reinstating…',
      variant: 'default',
    },
    republish: {
      title: 'Republish this card?',
      description: 'Brings the card back as state="published" with distribution="manual". All previous accept/reject/pending recipients are cleared. You will need to broadcast or hand-pick recipients.',
      confirmLabel: 'Republish',
      pendingLabel: 'Republishing…',
      variant: 'warning',
    },
    deletePermanent: {
      title: 'Move this card to Trash?',
      description: 'The card moves to admin Trash, where you can restore it or delete it forever. Recipients and secondary cards are removed only when you permanently delete it from there.',
      confirmLabel: 'Move to Trash',
      pendingLabel: 'Moving…',
      variant: 'danger',
    },
    broadcast: {
      title: 'Send to everyone matching?',
      description: 'Overrides soft-publish: switches the card to broadcast and auto-matches every partner and talent that fits the targeting criteria.',
      confirmLabel: 'Send to all',
      pendingLabel: 'Switching…',
      variant: 'default',
    },
    broadcastNow: {
      title: 'Broadcast now?',
      description: 'Sends the card to its staged recipients — releasing matched partners and notifying talents. Soft-published cards send only the recipients you hand-picked.',
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
  parentCard: AdminSubscriptionCard;
  secondaryCards: AdminSubscriptionCard[];
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
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
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

function CardDetails({ card, activeCard, isSecondaryView, countries, squadhireCategories }: { card: AdminSubscriptionCard; activeCard: AdminSubscriptionCard; isSecondaryView: boolean; countries: Country[]; squadhireCategories: Array<{ id: string; name: string }> }) {
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

  // Pricing model (see shared helpers): finalized price = subscription_price
  // ?? proposed_price; final margin = adjusted (markup) ?? plan margin;
  // partner price = override ?? (finalized − final margin).
  const cur = priceCurrency || '₹';
  const finalizedPrice = resolveFinalizedPrice(card);
  const planMargin = resolvePlanMargin(planPrice, finalizedPrice);
  const partnerPrice = resolvePartnerPrice(card, planPrice);

  // Plan summary — the plan's identity (name/tier/service) alongside its
  // headline deliverable (hours) and finalized monthly price. The full
  // breakdown stays in the Deliverables/Pricing/Margin sections below.
  const planNameDisplay = plan?.plan || card.plan_name || EMPTY;
  const planTierDisplay = plan?.tier || EMPTY;
  const serviceDisplay =
    card.submission_subscription?.subscription?.name || card.service_type || EMPTY;
  const hoursDeliverable = (card.plan_default_deliverables || []).find((d) => d.kind === 'hours');
  const planHoursDisplay = hoursDeliverable
    ? [
        hoursDeliverable.per_day ? `${hoursDeliverable.per_day} hrs/day` : null,
        hoursDeliverable.per_week ? `${hoursDeliverable.per_week} hrs/week` : null,
        hoursDeliverable.per_month ? `${hoursDeliverable.per_month} hrs/month` : null,
      ].filter(Boolean).join(' · ') || EMPTY
    : EMPTY;
  const isAssignmentCard = card.card_type === 'assignment';
  const per = isAssignmentCard ? '' : '/mo';
  const planPriceDisplay = finalizedPrice != null ? `${cur} ${finalizedPrice.toLocaleString()}${per}` : EMPTY;
  const hasAgreedBid =
    card.subscription_price != null &&
    card.subscription_price > 0 &&
    (card.state === 'assigned' ||
      !!card.selected_recipient_id ||
      card.partner_price_override != null);

  return (
    <div className="px-5 py-5 space-y-5 text-sm">
      {isSecondaryView && (
        <div className="rounded-lg bg-[var(--color-sh-lime-soft)] border border-[var(--color-sh-warm-border)] px-3 py-2">
          <p className="text-[11px] font-semibold text-[var(--color-sh-ink)]">
            Secondary card — content inherited from primary
          </p>
        </div>
      )}

      {hasAgreedBid && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Final agreed price
          </p>
          <p className="mt-1 text-sm font-semibold text-emerald-950">
            Business {cur} {Number(card.subscription_price).toLocaleString()}
            {per}
            {partnerPrice != null && (
              <span className="font-medium text-emerald-800">
                {' '}
                · Talent {cur} {partnerPrice.toLocaleString()}
                {per}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-emerald-800/80">
            Locked from the accepted bid after talent selection
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
          {activeCard.card_code && <CardCodeChip code={activeCard.card_code} />}
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

      {card.card_type === 'assignment' ? (
        <DetailSection title="Assignment">
          <DetailRow
            label="Pricing"
            value={card.assignment_details?.pricing_mode === 'unpriced' ? 'Invite offers — no price shown' : 'Priced — accept / decline / counter'}
          />
          <DetailRow
            label={card.assignment_details?.pricing_mode === 'unpriced' ? 'Budget ceiling' : 'Project budget'}
            value={card.proposed_price ? `${cur} ${card.proposed_price.toLocaleString()}` : EMPTY}
          />
          <DetailRow label="Service" value={serviceDisplay} />
          <DetailRow label="Duration" value={card.assignment_details?.duration || EMPTY} />
          <DetailRow label="Start date" value={card.assignment_details?.start_date || EMPTY} />
          <DetailRow label="Deadline" value={card.assignment_details?.deadline || EMPTY} />
          <DetailRow label="Scope type" value={card.assignment_details?.scope_type || EMPTY} />
        </DetailSection>
      ) : (
        <DetailSection title="Plan">
          <DetailRow label="Plan" value={planNameDisplay} />
          <DetailRow label="Tier" value={planTierDisplay} />
          <DetailRow label="Service" value={serviceDisplay} />
          <DetailRow label="Hours" value={planHoursDisplay} />
          <DetailRow label="Price" value={planPriceDisplay} />
        </DetailSection>
      )}

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
          value={card.proposed_price ? `${cur} ${card.proposed_price.toLocaleString()}${per}` : EMPTY}
        />
        <DetailRow
          label="Subscription price"
          value={card.subscription_price ? `${cur} ${card.subscription_price.toLocaleString()}${per}` : EMPTY}
        />
        {/* Preferred levels + client budgets from the brief. */}
        {(() => {
          const tiers = Array.isArray(card.target_tiers) ? card.target_tiers : [];
          const tp = card.tier_pricing && typeof card.tier_pricing === 'object' ? card.tier_pricing : {};
          if (tiers.length === 0 && !card.client_budget) return null;
          return (
            <div className="pt-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-muted)]">
                Client preferred levels
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tiers.map((tier) => {
                  const entry = (tp as any)[tier];
                  const budget =
                    (typeof entry?.client_budget === 'number' && entry.client_budget > 0
                      ? entry.client_budget
                      : null)
                    ?? (typeof entry?.proposed_price === 'number' &&
                      entry.proposed_price > 0 &&
                      !(entry?.subscription_price > 0)
                      ? entry.proposed_price
                      : null)
                    ?? (card.client_budget && card.client_budget > 0 ? card.client_budget : null);
                  return (
                    <span
                      key={tier}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-sh-ink)] bg-[var(--color-sh-lime-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-sh-ink)]"
                    >
                      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.8 5.7 21l2.3-7.2-6-4.4h7.6L12 2z" />
                      </svg>
                      {tier}
                      {budget != null && (
                        <span className="tabular-nums text-[var(--color-sh-ink-muted)]">
                          · {cur} {budget.toLocaleString()}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </DetailSection>

      <DetailSection title="Margin">
        <DetailRow
          label="Plan margin"
          value={planMargin != null ? `${cur} ${planMargin.toLocaleString()}/mo` : EMPTY}
        />
        <DetailRow
          label="Adjusted margin"
          value={card.markup != null ? `${cur} ${card.markup.toLocaleString()}/mo` : 'Using plan margin'}
        />
      </DetailSection>

      <DetailSection title="Partner price">
        <DetailRow
          label="Partner price (computed)"
          value={partnerPrice != null ? `${cur} ${partnerPrice.toLocaleString()}/mo` : EMPTY}
        />
        <DetailRow
          label="Partner price override"
          value={
            activeCard.partner_price_override != null
              ? `${cur} ${activeCard.partner_price_override.toLocaleString()}`
              : isSecondaryView
                ? 'Same as primary'
                : card.partner_price_override != null
                  ? `${cur} ${card.partner_price_override.toLocaleString()}`
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
        {card.card_code && (
          <div className="flex justify-between gap-3">
            <span className="text-xs text-[var(--color-sh-ink-faint)]">Card code</span>
            <CardCodeChip code={card.card_code} />
          </div>
        )}
        <DetailRow label="Card ID" value={card.id} />
        <DetailRow label="Created" value={card.created_at ? formatFullDateTime(card.created_at) : EMPTY} />
        <DetailRow label="Updated" value={card.updated_at ? formatFullDateTime(card.updated_at) : EMPTY} />
      </DetailSection>
    </div>
  );
}

const EMPTY = '—';

function sourceLabel(source: AdminSubscriptionCard['source']): string {
  if (source === 'request') return 'From request';
  if (source === 'custom') return 'Custom';
  if (source === 'submission') return 'From submission';
  return EMPTY;
}

function squadhireStatusLabel(card: AdminSubscriptionCard): string {
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
