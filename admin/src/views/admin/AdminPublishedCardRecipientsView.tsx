'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useSquadhireConfig } from '@/hooks/useSquadhireConfig';
import { openLeadInCRM } from '@/utils/squadCrm';
import type { PublishedCard } from './AdminPublishedCards';
import type { RecipientsResponse } from './AdminPublishedCardRecipientsPanel';

type UnifiedRecipient = {
  id: string;
  name: string;
  type: 'partner' | 'talent';
  status: 'accepted' | 'rejected' | 'pending';
  responded_at: string | null;
  assigned_manually: boolean;
  selected_at: string | null;
  passed_over_at: string | null;
  // Soft-publish staged broadcast: NULL = queued (not yet sent to SquadHire),
  // non-NULL = sent at this exact moment (rows in the same batch share a
  // timestamp). Always null for partners and for live-fetched SquadHire
  // matches (remoteTalents).
  notified_at: string | null;
  // Registration email — passed back from SquadHire's recipients endpoint so
  // the Auto-accept flow can resolve a talent to a SquadHub user by matching
  // email. Null when SquadHire couldn't fetch it.
  email: string | null;
};

type SquadHireTalent = {
  talent_user_id: string;
  talent_name: string;
  status: 'pending' | 'accepted' | 'rejected';
  responded_at: string | null;
  created_at: string;
  email?: string | null;
};

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

type StatusTab = 'all' | 'accepted' | 'rejected' | 'pending';

const STATUS_PILL: Record<'accepted' | 'rejected' | 'pending', { bg: string; color: string }> = {
  accepted: { bg: '#D1FAE5', color: '#065F46' },
  rejected: { bg: '#FEE2E2', color: '#B91C1C' },
  pending: { bg: '#FEF3C7', color: '#92400E' },
};

const STATUS_NUMBER: Record<'accepted' | 'rejected' | 'pending', string> = {
  accepted: '#059669',
  rejected: '#DC2626',
  pending: '#D97706',
};

export default function AdminPublishedCardRecipientsView({
  card,
  title,
  onBack,
  onOpenPanel,
}: {
  card: PublishedCard;
  title: string;
  onBack: () => void;
  onOpenPanel: () => void;
}) {
  const [activeTab, setActiveTab] = useState<StatusTab>('all');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { adminUrl, configured: shConfigured } = useSquadhireConfig();

  // Fetch local recipients (partners from SquadHub + talents who responded via callback)
  const { data, isLoading } = useQuery({
    queryKey: ['admin-card-recipients', card.id],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${card.id}/recipients`).then((r) => r.data?.data as RecipientsResponse),
  });

  // Fetch full talent list from SquadHire (includes pending talents who haven't responded)
  const hasSquadHireCategories = Array.isArray(card.squadhire_category_ids) && card.squadhire_category_ids.length > 0;
  const { data: shRecipientsRes } = useQuery({
    queryKey: ['admin-card-squadhire-recipients', card.id],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${card.id}/squadhire-recipients`).then((r) => r.data?.data as SquadHireTalent[]),
    enabled: hasSquadHireCategories,
  });
  const squadhireTalents: SquadHireTalent[] = shRecipientsRes || [];

  const allRecipients = useMemo<UnifiedRecipient[]>(() => {
    if (!data) return [];

    // Partners from SquadHub
    const partners: UnifiedRecipient[] = (data.partners || []).map((p) => ({
      id: p.id,
      name: p.name,
      type: 'partner',
      status: p.status,
      responded_at: p.responded_at,
      assigned_manually: !!p.assigned_manually,
      selected_at: p.selected_at ?? null,
      passed_over_at: p.passed_over_at ?? null,
      notified_at: null,
      email: null,
    }));

    // Build a set of talent IDs we already have from the local callback table
    // to avoid duplicating talents who responded (they exist in both sources)
    const localTalentIds = new Set(
      (data.talents || []).map((t) => t.external_user_id)
    );

    // Email lookup keyed by SquadHire talent_user_id. SquadHire is the
    // source of truth for talent emails; our local table doesn't store them,
    // so we cross-reference for any localTalent that also appears on the
    // SquadHire side.
    const emailByTalentId = new Map(
      squadhireTalents.map((t) => [t.talent_user_id, t.email ?? null] as const),
    );

    // Talents from local callback table (responded via webhook)
    const localTalents: UnifiedRecipient[] = (data.talents || []).map((t) => ({
      id: t.external_user_id,
      name: t.name || 'Unknown talent',
      type: 'talent',
      status: t.status,
      responded_at: t.responded_at,
      assigned_manually: !!t.assigned_manually,
      selected_at: t.selected_at ?? null,
      passed_over_at: t.passed_over_at ?? null,
      notified_at: t.notified_at ?? null,
      // Prefer the email persisted on our row (written by /assign-talent or
      // /auto-accept-talent); fall back to SquadHire's matched-recipient
      // email when our row predates the email column.
      email: t.email ?? emailByTalentId.get(t.external_user_id) ?? null,
    }));

    // Talents from SquadHire that are NOT already in local data
    // These are the ones who haven't responded yet (or whose callback hasn't arrived)
    const remoteTalents: UnifiedRecipient[] = squadhireTalents
      .filter((t) => !localTalentIds.has(t.talent_user_id))
      .map((t) => ({
        id: t.talent_user_id,
        name: t.talent_name || 'Unknown talent',
        type: 'talent',
        status: t.status,
        responded_at: t.responded_at,
        assigned_manually: false,
        selected_at: null,
        passed_over_at: null,
        notified_at: null,
        email: t.email ?? null,
      }));

    return [...partners, ...localTalents, ...remoteTalents];
  }, [data, squadhireTalents]);

  const canAssign = card.state === 'published' || card.state === 'assigned';

  // Pre-check already-selected recipients
  useEffect(() => {
    if (!canAssign) return;
    const preChecked = new Set<string>();
    for (const r of allRecipients) {
      if (r.status === 'accepted' && r.selected_at) {
        preChecked.add(`${r.type}-${r.id}`);
      }
    }
    setCheckedIds(preChecked);
  }, [allRecipients, canAssign]);

  const toggleCheck = (key: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const assignMutation = useMutation({
    mutationFn: () => {
      const partnerIds: string[] = [];
      const talentIds: string[] = [];
      for (const key of checkedIds) {
        const [type, ...rest] = key.split('-');
        const id = rest.join('-');
        if (type === 'partner') partnerIds.push(id);
        else talentIds.push(id);
      }
      return api.post(`/admin/subscription-cards/${card.id}/assign`, {
        partner_ids: partnerIds,
        talent_ids: talentIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-card-recipients', card.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
    },
  });

  const undoMutation = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${card.id}/undo-selection`),
    onSuccess: () => {
      setCheckedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin-card-recipients', card.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
    },
  });

  const markReviewedMutation = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${card.id}/mark-reviewed`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      showToast('Marked as reviewed.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to mark reviewed', 'error');
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${card.id}/finalize-selection`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-card-recipients', card.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      showToast('Card finalized — talent moved to Assigned.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to finalize', 'error');
    },
  });

  const broadcastMutation = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${card.id}/broadcast-pending`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-card-recipients', card.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-card-squadhire-recipients', card.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
    },
  });

  const [autoAcceptTarget, setAutoAcceptTarget] = useState<{ id: string; name: string; email: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string; type: 'partner' | 'talent' } | null>(null);

  const removeRecipientMutation = useMutation({
    mutationFn: ({ id, type }: { id: string; type: 'partner' | 'talent' }) =>
      type === 'partner'
        ? api.delete(`/admin/subscription-cards/${card.id}/recipients/${id}`)
        : api.delete(`/admin/subscription-cards/${card.id}/external-recipients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-card-recipients', card.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-card-squadhire-recipients', card.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
      setRemoveTarget(null);
      showToast('Recipient removed.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to remove recipient', 'error');
      setRemoveTarget(null);
    },
  });

  const autoAcceptTalentMutation = useMutation({
    mutationFn: ({ talentId, talentName, email }: { talentId: string; talentName: string; email: string }) =>
      api.post(`/admin/subscription-cards/${card.id}/auto-accept-talent`, {
        talent_id: talentId,
        talent_name: talentName,
        email,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-card-recipients', card.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-card-squadhire-recipients', card.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-published-cards'] });
      setAutoAcceptTarget(null);
      showToast('Talent accepted on their behalf.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to auto-accept talent', 'error');
      setAutoAcceptTarget(null);
    },
  });
  const broadcastResult = broadcastMutation.data?.data as
    | { notified?: number; failed?: number }
    | undefined;
  const partialFailure =
    !!broadcastResult && (broadcastResult.failed ?? 0) > 0 && (broadcastResult.notified ?? 0) > 0;

  const counts = useMemo(() => ({
    accepted: allRecipients.filter((r) => r.status === 'accepted').length,
    rejected: allRecipients.filter((r) => r.status === 'rejected').length,
    pending: allRecipients.filter((r) => r.status === 'pending').length,
    total: allRecipients.length,
  }), [allRecipients]);

  const selectedRecipients = useMemo(
    () => allRecipients.filter((r) => r.selected_at),
    [allRecipients],
  );

  const filtered = useMemo(
    () => activeTab === 'all' ? allRecipients : allRecipients.filter((r) => r.status === activeTab),
    [allRecipients, activeTab],
  );

  const isManual = card.distribution === 'manual';

  // For manual cards: split talents into
  //   - pending: not yet broadcast AND still awaiting response (queue)
  //   - autoAccepted: not broadcast but already responded (e.g. an admin hit
  //     Auto-accept on a SquadHire match — they bypass the broadcast queue)
  //   - sentBatches: one group per distinct notified_at timestamp
  // Partners stay in their own flat section above the talent groups.
  const grouped = useMemo(() => {
    if (!isManual) return null;
    const partners = filtered.filter((r) => r.type === 'partner');
    const talents = filtered.filter((r) => r.type === 'talent');
    const pending: UnifiedRecipient[] = [];
    const autoAccepted: UnifiedRecipient[] = [];
    const sentMap = new Map<string, UnifiedRecipient[]>();
    for (const t of talents) {
      if (!t.notified_at) {
        if (t.status === 'pending') pending.push(t);
        else autoAccepted.push(t);
      } else {
        const arr = sentMap.get(t.notified_at) ?? [];
        arr.push(t);
        sentMap.set(t.notified_at, arr);
      }
    }
    const sentBatches = Array.from(sentMap.entries())
      .map(([notifiedAt, items]) => ({ notifiedAt, items }))
      .sort((a, b) => b.notifiedAt.localeCompare(a.notifiedAt));
    return { partners, pending, autoAccepted, sentBatches };
  }, [filtered, isManual]);

  // Pending count drives the "Broadcast to these N users" button — only
  // count rows that are actually awaiting broadcast (not auto-accepted
  // ones whose notified_at is null but already have a non-pending status).
  const totalPendingTalents = useMemo(
    () =>
      isManual
        ? allRecipients.filter((r) => r.type === 'talent' && !r.notified_at && r.status === 'pending').length
        : 0,
    [allRecipients, isManual],
  );

  // Bucket-aware state pill (mirrors AdminPublishedCards.categorize). A card
  // with selected_recipient_id always shows "Assigned" regardless of state.
  const bucket: 'active' | 'selected' | 'assigned' | 'cancelled' = card.selected_recipient_id
    ? 'assigned'
    : card.state === 'assigned'
      ? 'selected'
      : card.state === 'closed'
        ? 'cancelled'
        : 'active';
  const stateColor =
    bucket === 'active' ? '#10B981'
      : bucket === 'selected' ? '#0EA5E9'
      : bucket === 'assigned' ? '#059669'
      : '#6B7280';
  const stateLabel =
    bucket === 'active' ? 'Active'
      : bucket === 'selected' ? 'Selected'
      : bucket === 'assigned' ? 'Assigned'
      : 'Cancelled';
  const distLabel = card.distribution === 'manual' ? 'Published' : 'Broadcast';
  const publisher = card.published_by_user;
  const isUnreviewed = bucket === 'assigned' && !card.admin_reviewed_at;

  // Broadcast summary info
  const partnerCount = (card.recipient_counts?.partners?.pending ?? 0) +
    (card.recipient_counts?.partners?.accepted ?? 0) +
    (card.recipient_counts?.partners?.rejected ?? 0);
  const talentTotal = allRecipients.filter((r) => r.type === 'talent').length;
  const talentRespondedCount = allRecipients.filter((r) => r.type === 'talent' && r.responded_at).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="sh-btn-ghost sh-btn-ghost-sm"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Published Cards
          </button>
          <button
            onClick={onOpenPanel}
            className="sh-btn-ghost sh-btn-ghost-sm"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
            Card Details
          </button>
        </div>
        <div className="sh-card p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span
                  className="sh-status-pill"
                  style={{ backgroundColor: `${stateColor}1F`, color: stateColor }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
                  {stateLabel}
                </span>
                <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
                  {distLabel}
                </span>
                {card.recalled_at && (
                  <span className="sh-status-pill" style={{ backgroundColor: '#FFE9D9', color: '#9A3412' }}>
                    Recalled
                  </span>
                )}
                {isUnreviewed && (
                  <span
                    className="sh-status-pill"
                    style={{ backgroundColor: '#DC2626', color: 'white' }}
                    title="A talent has been assigned to this card. Mark as reviewed to clear the badge."
                  >
                    NEW
                  </span>
                )}
                {bucket === 'selected' && (
                  <>
                    <button
                      onClick={() => finalizeMutation.mutate()}
                      disabled={finalizeMutation.isPending}
                      className="sh-btn-success"
                      title="Mark the subscription active and move the card to Assigned."
                    >
                      {finalizeMutation.isPending ? 'Finalizing…' : 'Finalize'}
                    </button>
                    <button
                      onClick={() => undoMutation.mutate()}
                      disabled={undoMutation.isPending}
                      className="sh-btn-danger"
                    >
                      {undoMutation.isPending ? 'Reverting…' : 'Undo Selection'}
                    </button>
                  </>
                )}
                {isUnreviewed && (
                  <button
                    onClick={() => markReviewedMutation.mutate()}
                    disabled={markReviewedMutation.isPending}
                    className="sh-btn-success"
                  >
                    {markReviewedMutation.isPending ? 'Marking…' : 'Mark as Reviewed'}
                  </button>
                )}
              </div>
              <h1 className="sh-display text-2xl sm:text-3xl truncate">{title}</h1>
              {card.published_at && (
                <p className="mt-2 text-xs text-[var(--color-sh-ink-faint)]">
                  Published {new Date(card.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {publisher && <> by {publisher.display_name || publisher.email || publisher.id.slice(0, 8)}</>}
                </p>
              )}
            </div>
            <div className="lg:w-[280px] lg:shrink-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="sh-section-heading">Customer</h4>
                <button
                  type="button"
                  onClick={() => openLeadInCRM({
                    submission_id: card.submission?.id,
                    phone: card.customer_phone,
                    email: card.customer_email,
                  })}
                  title="Open this lead in Squad CRM"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-sh-ink-muted)] hover:bg-[var(--color-sh-cream)] hover:text-[var(--color-sh-ink)] transition"
                >
                  View in CRM
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </button>
              </div>
              <div className="space-y-1.5 text-xs">
                <HeaderDetailRow label="Contact Person" value={card.customer_name} />
                <HeaderDetailRow label="Email" value={card.customer_email} />
                <HeaderDetailRow label="Phone" value={card.customer_phone} />
                <HeaderDetailRow label="Location" value={card.customer_location} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards + tabs + list */}
      <div className="flex-1 overflow-y-auto px-6 pb-8 space-y-5">
        {isLoading ? (
          <div className="sh-card py-16 text-center">
            <p className="text-sm text-[var(--color-sh-ink-faint)]">Loading recipients…</p>
          </div>
        ) : (
          <>
            {/* Selected talent(s) — emerald card mirroring the SquadHire business view */}
            {selectedRecipients.length > 0 && (
              <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/50 p-5 sm:p-6">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {selectedRecipients.length === 1 ? 'Selected Talent' : `Selected Talents (${selectedRecipients.length})`}
                </h2>
                <div className="space-y-3">
                  {selectedRecipients.map((r) => (
                    <div key={`selected-${r.type}-${r.id}`} className="flex items-center gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--color-sh-ink)] text-base font-bold ring-1 ring-emerald-200">
                        {r.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-[15px] font-semibold text-[#0a0a0a]">
                            {r.name}
                          </p>
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={r.type === 'partner'
                              ? { backgroundColor: '#DBEAFE', color: '#1E40AF' }
                              : { backgroundColor: '#F2EBFE', color: '#6B21A8' }}
                          >
                            {r.type === 'partner' ? 'Partner' : 'Talent'}
                          </span>
                        </div>
                        {r.responded_at && (
                          <p className="mt-0.5 truncate text-xs text-[#737373]">
                            Responded {formatRelative(r.responded_at)}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {r.type === 'talent' && adminUrl && (
                          <a
                            href={`${adminUrl}/admin/users/${r.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View profile in SquadHire"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-100 transition"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                        )}
                        <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Selected
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Broadcast summary */}
            <div
              className="sh-card flex flex-wrap items-center gap-2 px-4 py-3"
              style={{
                background: hasSquadHireCategories ? 'var(--color-sh-lime-soft)' : '#FEF3C7',
                borderColor: hasSquadHireCategories ? 'var(--color-sh-warm-border)' : '#FCD9B6',
              }}
            >
              <svg className="h-4 w-4 text-[var(--color-sh-ink-subtle)]" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
              </svg>
              <span className="text-xs text-[var(--color-sh-ink-muted)]">
                Broadcasted to <span className="font-bold text-[var(--color-sh-ink)]">{partnerCount} partner{partnerCount !== 1 ? 's' : ''}</span>
              </span>
              {hasSquadHireCategories && (
                <>
                  <span className="text-xs text-[var(--color-sh-ink-faint)]">·</span>
                  <span className="text-xs text-[var(--color-sh-ink-muted)]">
                    Sent to <span className="font-bold text-[var(--color-sh-ink)]">{talentTotal} talent{talentTotal !== 1 ? 's' : ''}</span> via SquadHire
                    {talentTotal > 0 && <> ({talentRespondedCount} responded)</>}
                  </span>
                </>
              )}
              {!hasSquadHireCategories && (
                <>
                  <span className="text-xs text-[var(--color-sh-ink-faint)]">·</span>
                  <span className="text-xs font-semibold text-[#92400E]">Not sent to SquadHire (no categories)</span>
                </>
              )}
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-3">
              {(['accepted', 'rejected', 'pending'] as const).map((status) => {
                const isActive = activeTab === status;
                return (
                  <button
                    key={status}
                    onClick={() => setActiveTab(status)}
                    className="sh-card sh-card-interactive p-5 text-left"
                    style={isActive ? { boxShadow: 'inset 0 0 0 1.5px var(--color-sh-ink), 0 4px 12px rgba(0,0,0,0.08)' } : undefined}
                  >
                    <p className="sh-section-heading">
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </p>
                    <p className="sh-display text-3xl mt-1.5" style={{ color: STATUS_NUMBER[status] }}>
                      {counts[status]}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Tab bar */}
            <div className="overflow-x-auto">
              <div className="sh-tab-bar">
                {(['all', 'accepted', 'rejected', 'pending'] as const).map((tab) => {
                  const count = tab === 'all' ? counts.total : counts[tab];
                  const label = tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1);
                  return (
                    <button
                      key={tab}
                      type="button"
                      data-active={activeTab === tab}
                      onClick={() => setActiveTab(tab)}
                      className="sh-tab"
                    >
                      {label} <span className="opacity-70">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recipient list */}
            {(() => {
              const renderRow = (r: UnifiedRecipient) => {
                const statusCfg = STATUS_PILL[r.status];
                const rowKey = `${r.type}-${r.id}`;
                const showCheckbox = canAssign && r.status === 'accepted';
                return (
                  <div key={rowKey} className="sh-card flex items-center gap-3 px-4 py-3">
                    {showCheckbox && (
                      <input
                        type="checkbox"
                        checked={checkedIds.has(rowKey)}
                        onChange={() => toggleCheck(rowKey)}
                        className="h-4 w-4 shrink-0 rounded border-[var(--color-sh-warm-border)] text-[var(--color-sh-ink)] focus:ring-[var(--color-sh-ink)]/20 cursor-pointer"
                      />
                    )}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]">
                      {r.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">{r.name}</p>
                      {r.responded_at ? (
                        <p className="text-[11px] text-[var(--color-sh-ink-faint)]">Responded {formatRelative(r.responded_at)}</p>
                      ) : r.status === 'pending' ? (
                        <p className="text-[11px] text-[var(--color-sh-ink-faint)]">Awaiting response</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {activeTab === 'all' && (
                        <span className="sh-status-pill" style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}>
                          {r.status}
                        </span>
                      )}
                      <span
                        className="sh-status-pill"
                        style={r.type === 'partner'
                          ? { backgroundColor: '#DBEAFE', color: '#1E40AF' }
                          : { backgroundColor: '#F2EBFE', color: '#6B21A8' }}
                      >
                        {r.type === 'partner' ? 'Partner' : 'Talent'}
                      </span>
                      {r.type === 'talent' && (
                        <a
                          href={adminUrl ? `${adminUrl}/admin/users/${r.id}` : '#'}
                          target={adminUrl ? '_blank' : undefined}
                          rel="noopener noreferrer"
                          title={adminUrl ? 'View profile in SquadHire' : 'SquadHire admin URL not configured'}
                          onClick={adminUrl ? undefined : (e) => e.preventDefault()}
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${adminUrl ? 'text-[var(--color-sh-ink-faint)] hover:bg-[var(--color-sh-cream)] hover:text-[var(--color-sh-ink)]' : 'text-[var(--color-sh-ink-faint)] opacity-40 cursor-not-allowed'}`}
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                      )}
                      {r.assigned_manually && (
                        <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
                          Manual
                        </span>
                      )}
                      {r.selected_at && (
                        <span className="sh-status-pill" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>
                          Selected
                        </span>
                      )}
                      {r.passed_over_at && !r.selected_at && (
                        <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
                          Not selected
                        </span>
                      )}
                      {isManual
                        && r.type === 'talent'
                        && r.status === 'pending'
                        && !r.selected_at
                        && !r.passed_over_at
                        && card.state === 'published'
                        && r.email
                        && (
                          <button
                            type="button"
                            onClick={() => setAutoAcceptTarget({ id: r.id, name: r.name, email: r.email! })}
                            disabled={autoAcceptTalentMutation.isPending}
                            title={`Accept on behalf of ${r.name}`}
                            className="sh-btn-success"
                          >
                            Auto-accept
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={() => setRemoveTarget({ id: r.id, name: r.name, type: r.type })}
                        disabled={removeRecipientMutation.isPending}
                        aria-label={`Remove ${r.name}`}
                        title="Remove from this card"
                        className="rounded-md p-1.5 text-[var(--color-sh-ink-faint)] hover:bg-red-50 hover:text-red-600 transition disabled:opacity-30"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              };

              if (!grouped) {
                if (filtered.length === 0) {
                  return (
                    <div className="sh-card py-12 text-center">
                      <p className="text-sm text-[var(--color-sh-ink-subtle)]">
                        {activeTab === 'all' ? 'No recipients yet.' : `No ${activeTab} recipients.`}
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-2">
                    {filtered.map(renderRow)}
                  </div>
                );
              }

              const { partners: gPartners, pending: gPending, autoAccepted: gAutoAccepted, sentBatches } = grouped;
              const totalGroups = (gPartners.length > 0 ? 1 : 0) + (gPending.length > 0 ? 1 : 0) + (gAutoAccepted.length > 0 ? 1 : 0) + sentBatches.length;
              if (totalGroups === 0) {
                return (
                  <div className="sh-card py-12 text-center">
                    <p className="text-sm text-[var(--color-sh-ink-subtle)]">
                      {activeTab === 'all' ? 'No recipients yet.' : `No ${activeTab} recipients.`}
                    </p>
                  </div>
                );
              }

              return (
                <div className="space-y-6">
                  {gPartners.length > 0 && (
                    <section>
                      <h3 className="sh-section-heading mb-3">
                        Partners ({gPartners.length})
                      </h3>
                      <div className="space-y-2">
                        {gPartners.map(renderRow)}
                      </div>
                    </section>
                  )}

                  {gAutoAccepted.length > 0 && (
                    <section>
                      <h3 className="sh-section-heading mb-3" style={{ color: '#065F46' }}>
                        Accepted on their behalf ({gAutoAccepted.length})
                      </h3>
                      <div className="space-y-2">
                        {gAutoAccepted.map(renderRow)}
                      </div>
                    </section>
                  )}

                  {gPending.length > 0 && (
                    <section>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="sh-section-heading" style={{ color: '#B45309' }}>
                          Pending broadcast ({gPending.length})
                        </h3>
                      </div>
                      <div
                        className="sh-card p-3 space-y-2"
                        style={{ background: '#FEF8E6', borderColor: '#FCD9B6' }}
                      >
                        {gPending.map(renderRow)}
                      </div>
                      {totalPendingTalents > 0 && canAssign && (
                        <div className="mt-3 flex justify-end">
                          <button
                            onClick={() => broadcastMutation.mutate()}
                            disabled={broadcastMutation.isPending}
                            className="sh-btn-primary sh-btn-primary-sm"
                          >
                            {broadcastMutation.isPending ? (
                              <>
                                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Broadcasting…
                              </>
                            ) : (
                              `Broadcast to these ${totalPendingTalents} user${totalPendingTalents !== 1 ? 's' : ''}`
                            )}
                          </button>
                        </div>
                      )}
                      {broadcastMutation.isError && (
                        <p className="mt-2 text-right text-[11px] text-red-600">
                          {(broadcastMutation.error as any)?.response?.data?.error || 'Broadcast failed. Try again.'}
                        </p>
                      )}
                      {partialFailure && (
                        <p className="mt-2 text-right text-[11px] text-amber-700">
                          {broadcastResult!.notified} sent · {broadcastResult!.failed} couldn't be reached. Retry to send the rest.
                        </p>
                      )}
                    </section>
                  )}

                  {sentBatches.map((batch) => (
                    <section key={batch.notifiedAt}>
                      <h3 className="sh-section-heading mb-3">
                        Sent {formatRelative(batch.notifiedAt)} · {batch.items.length} talent{batch.items.length !== 1 ? 's' : ''}
                      </h3>
                      <div className="space-y-2">
                        {batch.items.map(renderRow)}
                      </div>
                    </section>
                  ))}
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* Floating Assign bar */}
      {canAssign && checkedIds.size > 0 && (
        <div className="sticky bottom-0 px-6 py-4 sh-surface border-t border-[var(--color-sh-warm-border)] flex items-center justify-between shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
          <span className="text-sm text-[var(--color-sh-ink-muted)]">
            {checkedIds.size} recipient{checkedIds.size !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => assignMutation.mutate()}
            disabled={assignMutation.isPending}
            className="sh-btn-primary"
          >
            {assignMutation.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Assigning…
              </>
            ) : (
              `Assign (${checkedIds.size})`
            )}
          </button>
        </div>
      )}
      {autoAcceptTarget && (
        <ConfirmDialog
          open
          title="Auto-accept talent?"
          description={`Accept this card on behalf of ${autoAcceptTarget.name} (${autoAcceptTarget.email}). They'll be visible to the business user immediately and won't need to respond on SquadHire. Requires a matching SquadHub user account.`}
          confirmLabel="Auto-accept"
          pendingLabel="Accepting…"
          variant="default"
          isPending={autoAcceptTalentMutation.isPending}
          onCancel={() => setAutoAcceptTarget(null)}
          onConfirm={() =>
            autoAcceptTalentMutation.mutate({
              talentId: autoAcceptTarget.id,
              talentName: autoAcceptTarget.name,
              email: autoAcceptTarget.email,
            })
          }
        />
      )}
      {removeTarget && (
        <ConfirmDialog
          open
          title={`Remove ${removeTarget.type === 'partner' ? 'partner' : 'talent'}?`}
          description={`Remove ${removeTarget.name} from this card? They'll stop seeing it in their ${removeTarget.type === 'partner' ? 'opportunities' : 'subscription'} feed.`}
          confirmLabel="Remove"
          pendingLabel="Removing…"
          variant="danger"
          isPending={removeRecipientMutation.isPending}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() =>
            removeRecipientMutation.mutate({ id: removeTarget.id, type: removeTarget.type })
          }
        />
      )}
    </div>
  );
}

function HeaderDetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--color-sh-ink-faint)]">{label}</span>
      <span className="truncate text-[var(--color-sh-ink)]" title={value ?? undefined}>
        {value || '—'}
      </span>
    </div>
  );
}
