'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useSquadhireConfig } from '@/hooks/useSquadhireConfig';
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

const STATUS_COLORS: Record<'accepted' | 'rejected' | 'pending', { color: string; border: string; chipBg: string; chipText: string }> = {
  accepted: { color: 'text-emerald-700', border: 'border-emerald-400', chipBg: 'bg-emerald-100', chipText: 'text-emerald-700' },
  rejected: { color: 'text-red-700', border: 'border-red-400', chipBg: 'bg-red-100', chipText: 'text-red-700' },
  pending: { color: 'text-amber-700', border: 'border-amber-400', chipBg: 'bg-amber-100', chipText: 'text-amber-700' },
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
      email: emailByTalentId.get(t.external_user_id) ?? null,
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

  const filtered = useMemo(
    () => activeTab === 'all' ? allRecipients : allRecipients.filter((r) => r.status === activeTab),
    [allRecipients, activeTab],
  );

  const isManual = card.distribution === 'manual';

  // For manual cards: split talents into the pending-broadcast queue and one
  // group per distinct notified_at timestamp (one per batch). Partners stay
  // in their own flat section above the talent groups.
  const grouped = useMemo(() => {
    if (!isManual) return null;
    const partners = filtered.filter((r) => r.type === 'partner');
    const talents = filtered.filter((r) => r.type === 'talent');
    const pending: UnifiedRecipient[] = [];
    const sentMap = new Map<string, UnifiedRecipient[]>();
    for (const t of talents) {
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
    return { partners, pending, sentBatches };
  }, [filtered, isManual]);

  // Pending count is independent of the active status tab — the "Broadcast
  // to these N users" button needs the total queue size, not the filtered
  // view. (In practice all queued rows are status='pending' anyway.)
  const totalPendingTalents = useMemo(
    () =>
      isManual
        ? allRecipients.filter((r) => r.type === 'talent' && !r.notified_at).length
        : 0,
    [allRecipients, isManual],
  );

  const stateColor = card.state === 'published' ? '#10B981' : card.state === 'assigned' ? '#0EA5E9' : '#6B7280';
  const stateLabel = card.state === 'published' ? 'Active' : card.state === 'assigned' ? 'Assigned' : 'Cancelled';
  const distLabel = card.distribution === 'manual' ? 'Published' : 'Broadcast';
  const publisher = card.published_by_user;

  // Broadcast summary info
  const partnerCount = (card.recipient_counts?.partners?.pending ?? 0) +
    (card.recipient_counts?.partners?.accepted ?? 0) +
    (card.recipient_counts?.partners?.rejected ?? 0);
  const talentTotal = allRecipients.filter((r) => r.type === 'talent').length;
  const talentRespondedCount = allRecipients.filter((r) => r.type === 'talent' && r.responded_at).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-[#E2E8F0] bg-white px-6 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm text-[#62748E] hover:text-[#0F172B] transition"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Published Cards
          </button>
          <button
            onClick={onOpenPanel}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#62748E] hover:bg-[#F8FAFC] transition"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
            Card Details
          </button>
        </div>
        <h1 className="text-lg font-semibold text-[#0F172B] truncate">{title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: `${stateColor}18`, color: stateColor }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
            {stateLabel}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            {distLabel}
          </span>
          {card.recalled_at && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800">
              Recalled
            </span>
          )}
          {card.state === 'assigned' && (
            <button
              onClick={() => undoMutation.mutate()}
              disabled={undoMutation.isPending}
              className="rounded-full bg-red-50 px-2.5 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-100 transition disabled:opacity-50"
            >
              {undoMutation.isPending ? 'Reverting...' : 'Undo Assignment'}
            </button>
          )}
          {card.published_at && (
            <span className="text-xs text-[#90A1B9]">
              Published {new Date(card.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {publisher && <> by {publisher.display_name || publisher.email || publisher.id.slice(0, 8)}</>}
            </span>
          )}
        </div>
      </div>

      {/* Stat cards + tabs + list */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-[#90A1B9]">Loading recipients...</p>
        ) : (
          <>
            {/* Broadcast summary */}
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
              <svg className="h-4 w-4 text-[#90A1B9]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
              </svg>
              <span className="text-xs text-[#62748E]">
                Broadcasted to <span className="font-semibold text-[#0F172B]">{partnerCount} partner{partnerCount !== 1 ? 's' : ''}</span>
              </span>
              {hasSquadHireCategories && (
                <>
                  <span className="text-xs text-[#90A1B9]">&middot;</span>
                  <span className="text-xs text-[#62748E]">
                    Sent to <span className="font-semibold text-[#0F172B]">{talentTotal} talent{talentTotal !== 1 ? 's' : ''}</span> via SquadHire
                    {talentTotal > 0 && <> ({talentRespondedCount} responded)</>}
                  </span>
                </>
              )}
              {!hasSquadHireCategories && (
                <>
                  <span className="text-xs text-[#90A1B9]">&middot;</span>
                  <span className="text-xs text-amber-600">Not sent to SquadHire (no categories)</span>
                </>
              )}
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {(['accepted', 'rejected', 'pending'] as const).map((status) => {
                const cfg = STATUS_COLORS[status];
                return (
                  <button
                    key={status}
                    onClick={() => setActiveTab(status)}
                    className={`rounded-lg border bg-white p-4 text-left transition ${
                      activeTab === status
                        ? `border-l-4 ${cfg.border} shadow-sm`
                        : 'border-[#E2E8F0] hover:shadow-sm'
                    }`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#90A1B9]">
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </p>
                    <p className={`mt-1 text-2xl font-bold ${cfg.color}`}>
                      {counts[status]}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 border-b border-[#E2E8F0] mb-4">
              {(['all', 'accepted', 'rejected', 'pending'] as const).map((tab) => {
                const isActive = activeTab === tab;
                const count = tab === 'all' ? counts.total : counts[tab];
                const label = tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1);
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
                      isActive
                        ? 'border-[#0F172B] text-[#0F172B]'
                        : 'border-transparent text-[#62748E] hover:text-[#0F172B]'
                    }`}
                  >
                    {label} ({count})
                  </button>
                );
              })}
            </div>

            {/* Recipient list */}
            {(() => {
              const renderRow = (r: UnifiedRecipient) => {
                const statusCfg = STATUS_COLORS[r.status];
                const rowKey = `${r.type}-${r.id}`;
                const showCheckbox = canAssign && r.status === 'accepted';
                return (
                  <div key={rowKey} className="flex items-center gap-3 px-4 py-3">
                    {showCheckbox && (
                      <input
                        type="checkbox"
                        checked={checkedIds.has(rowKey)}
                        onChange={() => toggleCheck(rowKey)}
                        className="h-4 w-4 shrink-0 rounded border-gray-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                      />
                    )}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 text-sm font-semibold">
                      {r.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#0F172B]">{r.name}</p>
                      {r.responded_at ? (
                        <p className="text-[11px] text-[#90A1B9]">Responded {formatRelative(r.responded_at)}</p>
                      ) : r.status === 'pending' ? (
                        <p className="text-[11px] text-[#90A1B9]">Awaiting response</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {activeTab === 'all' && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusCfg.chipBg} ${statusCfg.chipText}`}>
                          {r.status}
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        r.type === 'partner'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-purple-50 text-purple-700'
                      }`}>
                        {r.type === 'partner' ? 'Partner' : 'Talent'}
                      </span>
                      {r.type === 'talent' && shConfigured && adminUrl && (
                        <a
                          href={`${adminUrl}/admin/users/${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View in SquadHire"
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-[#90A1B9] hover:bg-purple-50 hover:text-purple-600 transition"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                      )}
                      {r.assigned_manually && (
                        <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">
                          Manual
                        </span>
                      )}
                      {r.selected_at && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                          Selected
                        </span>
                      )}
                      {r.passed_over_at && !r.selected_at && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
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
                            className="rounded-md bg-emerald-600 px-2.5 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-30"
                          >
                            Auto-accept
                          </button>
                        )}
                    </div>
                  </div>
                );
              };

              if (!grouped) {
                if (filtered.length === 0) {
                  return (
                    <div className="rounded-lg border border-[#E2E8F0] bg-white py-10 text-center">
                      <p className="text-sm text-[#90A1B9]">
                        {activeTab === 'all' ? 'No recipients yet.' : `No ${activeTab} recipients.`}
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="rounded-lg border border-[#E2E8F0] bg-white divide-y divide-[#E2E8F0]">
                    {filtered.map(renderRow)}
                  </div>
                );
              }

              const { partners: gPartners, pending: gPending, sentBatches } = grouped;
              const totalGroups = (gPartners.length > 0 ? 1 : 0) + (gPending.length > 0 ? 1 : 0) + sentBatches.length;
              if (totalGroups === 0) {
                return (
                  <div className="rounded-lg border border-[#E2E8F0] bg-white py-10 text-center">
                    <p className="text-sm text-[#90A1B9]">
                      {activeTab === 'all' ? 'No recipients yet.' : `No ${activeTab} recipients.`}
                    </p>
                  </div>
                );
              }

              return (
                <div className="space-y-5">
                  {gPartners.length > 0 && (
                    <section>
                      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#62748E]">
                        Partners ({gPartners.length})
                      </h3>
                      <div className="rounded-lg border border-[#E2E8F0] bg-white divide-y divide-[#E2E8F0]">
                        {gPartners.map(renderRow)}
                      </div>
                    </section>
                  )}

                  {gPending.length > 0 && (
                    <section>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                          Pending broadcast ({gPending.length})
                        </h3>
                      </div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50/40 divide-y divide-amber-100">
                        {gPending.map(renderRow)}
                      </div>
                      {totalPendingTalents > 0 && canAssign && (
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => broadcastMutation.mutate()}
                            disabled={broadcastMutation.isPending}
                            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition disabled:opacity-50"
                          >
                            {broadcastMutation.isPending ? (
                              <>
                                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Broadcasting...
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
                      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#62748E]">
                        Sent {formatRelative(batch.notifiedAt)} · {batch.items.length} talent{batch.items.length !== 1 ? 's' : ''}
                      </h3>
                      <div className="rounded-lg border border-[#E2E8F0] bg-white divide-y divide-[#E2E8F0]">
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
        <div className="sticky bottom-0 border-t border-[#E2E8F0] bg-white px-6 py-3 flex items-center justify-between shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <span className="text-sm text-[#62748E]">
            {checkedIds.size} recipient{checkedIds.size !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => assignMutation.mutate()}
            disabled={assignMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700 transition disabled:opacity-50"
          >
            {assignMutation.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Assigning...
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
    </div>
  );
}
