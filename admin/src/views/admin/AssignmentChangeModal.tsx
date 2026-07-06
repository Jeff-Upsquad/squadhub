'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Post-assignment change modal: upgrade/downgrade the plan, change the
// assigned talent, or pause/cancel — on the SAME card, with billing splitting
// at the boundary. Talent change offers the primary "find a new one" path
// (reopen + rebroadcast) and a direct hand-pick shortcut. When the card is
// paused the modal becomes the resume surface: re-assign the previous talent
// (with an availability check) or rebroadcast for a new one.

type Mode = 'plan' | 'talent' | 'lifecycle';

interface PreviousTalentAvailability {
  has_previous_talent: boolean;
  recipient_type?: 'talent' | 'partner';
  talent_id?: string;
  talent_name?: string | null;
  available_weekly_hours?: number | null;
  committed_weekly_hours?: number;
  free_weekly_hours?: number | null;
  active_other_cards?: number;
}

interface MatchPool {
  count: number;
  talents: Array<{ talent_user_id: string; talent_name: string }>;
}

interface PlanOption {
  id: string;
  plan: string | null;
  tier: string | null;
  daily_hours: number | null;
  weekly_hours: number | null;
}

type TalentHit = { id: string; name: string; email: string | null; country: string | null; tier: string | null };
type PartnerHit = { id: string; name: string; email: string | null; tier: string | null; country_id: string | null };

// IST calendar day — must match the server's isFutureEffectiveDate guard, or
// an admin in a timezone ahead of IST would get "cannot be in the future" for
// the untouched default date.
function todayISO(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function AssignmentChangeModal({
  cardId,
  onClose,
  pausedAt = null,
  published = false,
}: {
  cardId: string;
  onClose: () => void;
  /** subscription_cards.paused_at — when set, the modal shows the resume flow. */
  pausedAt?: string | null;
  /**
   * Reopened-card mode: the card is back in Published (came from a prior
   * assignment). Shows only Change plan + Change talent — no lifecycle tab, no
   * billing-split date (nothing is billed while unassigned) — and change-talent
   * hand-picks a direct assignment. Ignored while paused (resume takes over).
   */
  published?: boolean;
}) {
  const qc = useQueryClient();
  const isPaused = !!pausedAt;
  const isPublished = published && !isPaused;
  const [mode, setMode] = useState<Mode>('plan');
  const [effectiveDate, setEffectiveDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-card-recipients', cardId] });
    qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
    qc.invalidateQueries({ queryKey: ['admin-subscription-assignments'] });
  };
  const onErr = (err: any) => setError(err?.response?.data?.error || err.message || 'Something went wrong');

  // ---- Change plan ----
  const [planId, setPlanId] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const planOptionsQ = useQuery({
    queryKey: ['admin-card-plan-options', cardId],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${cardId}/plan-options`).then((r) => r.data?.data as { current_plan_id: string | null; plans: PlanOption[] }),
    enabled: mode === 'plan',
  });
  const plans = planOptionsQ.data?.plans ?? [];
  const currentPlanId = planOptionsQ.data?.current_plan_id ?? null;

  const changePlan = useMutation({
    mutationFn: () =>
      api.post(`/admin/subscription-cards/${cardId}/change-plan`, {
        plan_id: planId,
        effective_date: effectiveDate,
        ...(newPrice.trim() ? { subscription_price: Number(newPrice) } : {}),
      }),
    onSuccess: (r) => {
      const warning = r.data?.warning as string | undefined;
      if (warning) showToast(warning, 'error');
      invalidate();
      onClose();
    },
    onError: onErr,
  });

  // ---- Change talent (direct hand-pick) ----
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  const talentsQ = useQuery({
    queryKey: ['admin-talent-search', debounced],
    queryFn: () => api.get('/admin/talents/search', { params: { q: debounced } }).then((r) => (r.data?.data as TalentHit[]) ?? []),
    enabled: mode === 'talent' && debounced.length > 0,
    retry: 0,
  });
  const partnersQ = useQuery({
    queryKey: ['admin-partner-search', debounced],
    queryFn: () => api.get('/admin/partners/search', { params: { q: debounced } }).then((r) => (r.data?.data as PartnerHit[]) ?? []),
    enabled: mode === 'talent' && debounced.length > 0,
  });

  const changeTalent = useMutation({
    mutationFn: (v: { recipient_type: 'talent' | 'partner'; recipient_id: string; recipient_name?: string; recipient_email?: string }) =>
      api.post(`/admin/subscription-cards/${cardId}/change-talent`, { ...v, effective_date: effectiveDate }),
    onSuccess: (r) => {
      const warning = r.data?.warning as string | undefined;
      if (warning) showToast(warning, 'error');
      invalidate();
      onClose();
    },
    onError: onErr,
  });

  // ---- Find a new talent (reopen + rebroadcast) ----
  const findNewTalent = useMutation({
    mutationFn: async () => {
      await api.post(`/admin/subscription-cards/${cardId}/reopen-for-new-talents`, { effective_date: effectiveDate });
      await api.post(`/admin/subscription-cards/${cardId}/rebroadcast`);
    },
    onSuccess: () => { invalidate(); onClose(); },
    onError: onErr,
  });

  // ---- Pause / cancel / resume ----
  const withWarning = (r: any) => {
    const warning = r?.data?.warning as string | undefined;
    if (warning) showToast(warning, 'error');
    invalidate();
    onClose();
  };
  const pauseSub = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${cardId}/pause`),
    onSuccess: withWarning,
    onError: onErr,
  });
  const cancelSub = useMutation({
    mutationFn: () => api.post(`/admin/subscription-cards/${cardId}/cancel`),
    onSuccess: withWarning,
    onError: onErr,
  });
  const resumeSub = useMutation({
    mutationFn: (resumeMode: 'same_talent' | 'same_talent_offer' | 'rebroadcast') =>
      api.post(`/admin/subscription-cards/${cardId}/resume`, { mode: resumeMode }),
    onSuccess: withWarning,
    onError: onErr,
  });
  const availabilityQ = useQuery({
    queryKey: ['admin-card-prev-talent-availability', cardId],
    queryFn: () =>
      api
        .get(`/admin/subscription-cards/${cardId}/previous-talent-availability`)
        .then((r) => r.data?.data as PreviousTalentAvailability),
    enabled: isPaused,
  });
  // The pool a rebroadcast would reach — shown so "broadcast to all" isn't blind.
  const matchPoolQ = useQuery({
    queryKey: ['admin-card-match-pool', cardId],
    queryFn: () =>
      api
        .get(`/admin/subscription-cards/${cardId}/match-pool`)
        .then((r) => r.data?.data as MatchPool),
    enabled: isPaused,
  });

  const talents = talentsQ.data ?? [];
  const partners = partnersQ.data ?? [];
  const busy =
    changePlan.isPending ||
    changeTalent.isPending ||
    findNewTalent.isPending ||
    pauseSub.isPending ||
    cancelSub.isPending ||
    resumeSub.isPending;
  const avail = availabilityQ.data;
  const pool = matchPoolQ.data;
  const planLabel = (p: PlanOption) => [p.plan, p.tier].filter(Boolean).join(' · ') || 'Plan';
  const currentPlanLabel = useMemo(() => {
    const cur = plans.find((p) => p.id === currentPlanId);
    return cur ? planLabel(cur) : null;
  }, [plans, currentPlanId]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[600px] w-[560px] max-w-[95vw] flex-col overflow-hidden rounded-[16px] border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-sh-warm-border)] bg-surface px-5 py-4">
          <div className="space-y-1.5 min-w-0">
            <span className="sh-eyebrow"><span className="sh-eyebrow-dot" />{isPaused ? 'Resume subscription' : isPublished ? 'Reposted module' : 'Manage assignment'}</span>
            <h3 className="sh-display text-xl">{isPaused ? 'Bring this subscription back' : 'Change plan or talent'}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 rounded-md p-1 text-[var(--color-sh-ink-muted)] hover:bg-[var(--color-sh-cream)] hover:text-[var(--color-sh-ink)] transition">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Mode tabs + effective date (hidden while paused — resume is the only flow) */}
        {!isPaused && (
        <div className="border-b border-[var(--color-sh-warm-border)] bg-surface px-5 py-3 space-y-3">
          <div className="flex gap-2">
            <button onClick={() => { setMode('plan'); setError(null); }} className={mode === 'plan' ? 'sh-btn-primary sh-btn-primary-sm' : 'sh-btn-ghost sh-btn-ghost-sm'}>Change plan</button>
            <button onClick={() => { setMode('talent'); setError(null); }} className={mode === 'talent' ? 'sh-btn-primary sh-btn-primary-sm' : 'sh-btn-ghost sh-btn-ghost-sm'}>Change talent</button>
            {/* Reposted (Published) cards aren't a live assignment — pause/cancel don't apply. */}
            {!isPublished && (
              <button onClick={() => { setMode('lifecycle'); setError(null); }} className={mode === 'lifecycle' ? 'sh-btn-primary sh-btn-primary-sm' : 'sh-btn-ghost sh-btn-ghost-sm'}>Pause / Cancel</button>
            )}
          </div>
          {isPublished ? (
            <p className="text-[11px] text-[var(--color-sh-ink-muted)]">
              This module is reposted and waiting in Published. Changes apply to the card now; billing opens fresh on the new plan/talent when you re-assign.
            </p>
          ) : mode !== 'lifecycle' && (
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-faint)]">Effective date</span>
              <input type="date" value={effectiveDate} max={todayISO()} onChange={(e) => setEffectiveDate(e.target.value)} className="sh-input mt-1" />
              <span className="mt-1 block text-[11px] text-[var(--color-sh-ink-muted)]">Billing and the space's hours target split at this date. Today or earlier — the talent-side switch applies immediately.</span>
            </label>
          )}
        </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {isPaused ? (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Subscription paused since {new Date(pausedAt!).toLocaleDateString()}. Billing and the space's hours target stopped that day.
              </div>

              <div className="sh-card px-4 py-3">
                <p className="text-sm font-semibold text-[var(--color-sh-ink)]">The previous {avail?.recipient_type === 'partner' ? 'partner' : 'talent'}</p>
                {availabilityQ.isLoading ? (
                  <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">Checking availability…</p>
                ) : avail?.has_previous_talent ? (
                  <>
                    <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">
                      <span className="font-semibold text-[var(--color-sh-ink)]">{avail.talent_name ?? 'Previous talent'}</span>
                      {avail.available_weekly_hours != null ? (
                        <> — available <span className="font-semibold">{avail.available_weekly_hours}h/wk</span>, committed elsewhere <span className="font-semibold">{avail.committed_weekly_hours ?? 0}h/wk</span>{avail.free_weekly_hours != null && <> → free <span className={`font-semibold ${avail.free_weekly_hours > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{avail.free_weekly_hours}h/wk</span></>} ({avail.active_other_cards ?? 0} other active {avail.active_other_cards === 1 ? 'client' : 'clients'})</>
                      ) : (
                        <> — availability unknown (SquadHire unreachable or no self-declared hours)</>
                      )}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--color-sh-ink-faint)]">
                      {avail.recipient_type === 'partner'
                        ? 'Re-assigned directly — billing resumes today.'
                        : 'They get an offer and must accept before billing resumes. The card reopens to Published until they do.'}
                    </p>
                    <button onClick={() => resumeSub.mutate('same_talent_offer')} disabled={busy} className="sh-btn-primary sh-btn-primary-sm mt-2 disabled:opacity-50">
                      {resumeSub.isPending
                        ? 'Working…'
                        : avail.recipient_type === 'partner'
                          ? `Re-assign ${avail.talent_name ?? 'previous partner'}`
                          : `Send offer to ${avail.talent_name ?? 'previous talent'}`}
                    </button>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">No previous talent on record for this card.</p>
                )}
              </div>

              <div className="sh-card px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--color-sh-ink)]">Or broadcast to other available talents</p>
                  <button
                    type="button"
                    onClick={() => matchPoolQ.refetch()}
                    disabled={matchPoolQ.isFetching}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-sh-warm-border)] bg-surface px-2 py-0.5 text-[11px] font-medium text-[var(--color-sh-ink-muted)] hover:text-[var(--color-sh-ink)] disabled:opacity-50"
                  >
                    <svg className={`h-3 w-3 ${matchPoolQ.isFetching ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-3m2 9a8 8 0 01-14 3" /></svg>
                    {matchPoolQ.isFetching ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">Reopens the card to Published and invites the matching pool. Billing stays stopped until a new talent is finalized.</p>

                {matchPoolQ.isLoading ? (
                  <p className="mt-2 text-xs text-[var(--color-sh-ink-muted)]">Finding available talents…</p>
                ) : pool && pool.count > 0 ? (
                  <>
                    <div className="mt-2 rounded-md border border-[var(--color-sh-warm-border)] bg-surface px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-faint)]">
                        {pool.count} available {pool.count === 1 ? 'talent' : 'talents'}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {pool.talents.slice(0, 12).map((t) => (
                          <span key={t.talent_user_id} className="inline-flex items-center rounded-full bg-[var(--color-sh-lime-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-sh-ink)] ring-1 ring-[var(--color-sh-warm-border)]">
                            {t.talent_name}
                          </span>
                        ))}
                        {pool.count > Math.min(12, pool.talents.length) && (
                          <span className="inline-flex items-center px-1 text-[11px] text-[var(--color-sh-ink-muted)]">
                            +{pool.count - Math.min(12, pool.talents.length)} more
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => { if (window.confirm(`Broadcast to all ${pool.count} matching talents?\n\nThe card reopens to Published and everyone in the pool is invited. Billing stays stopped until one is finalized.`)) resumeSub.mutate('rebroadcast'); }}
                      disabled={busy}
                      className="sh-btn-primary sh-btn-primary-sm mt-2 disabled:opacity-50"
                    >
                      {resumeSub.isPending ? 'Broadcasting…' : `Broadcast to all ${pool.count}`}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-xs text-[var(--color-sh-ink-muted)]">No matching talents available right now. You can still reopen the card to Published to keep sourcing.</p>
                    <button onClick={() => resumeSub.mutate('rebroadcast')} disabled={busy} className="sh-btn-ghost sh-btn-ghost-sm mt-2 disabled:opacity-50">
                      {resumeSub.isPending ? 'Working…' : 'Reopen to Published'}
                    </button>
                  </>
                )}
              </div>

              <div className="border-t border-[var(--color-sh-warm-border)] pt-3">
                <button
                  onClick={() => { if (window.confirm('Cancel this subscription permanently?\n\nThe card closes, the talent is released, and billing stays stopped. This cannot be resumed.')) cancelSub.mutate(); }}
                  disabled={busy}
                  className="sh-btn-danger disabled:opacity-50"
                >
                  {cancelSub.isPending ? 'Cancelling…' : 'Cancel subscription permanently'}
                </button>
              </div>
            </div>
          ) : mode === 'lifecycle' ? (
            <div className="space-y-4">
              <div className="sh-card px-4 py-3">
                <p className="text-sm font-semibold text-[var(--color-sh-ink)]">Pause subscription</p>
                <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">Billing stops today; the talent is released on SquadHire and notified. Reports, payouts and the space's hours target stop from today. You can resume later — with the same talent (availability is checked) or by rebroadcasting.</p>
                <button
                  onClick={() => { if (window.confirm('Pause this subscription?\n\nBilling stops today and the talent is released until you resume.')) pauseSub.mutate(); }}
                  disabled={busy}
                  className="sh-btn-warning mt-2 disabled:opacity-50"
                >
                  {pauseSub.isPending ? 'Pausing…' : 'Pause subscription'}
                </button>
              </div>
              <div className="sh-card px-4 py-3">
                <p className="text-sm font-semibold text-[var(--color-sh-ink)]">Cancel subscription</p>
                <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">Billing stops today and the card closes permanently. The talent is released and notified. This cannot be undone.</p>
                <button
                  onClick={() => { if (window.confirm('Cancel this subscription permanently?\n\nBilling stops today, the card closes, and the talent is released. This cannot be undone.')) cancelSub.mutate(); }}
                  disabled={busy}
                  className="sh-btn-danger mt-2 disabled:opacity-50"
                >
                  {cancelSub.isPending ? 'Cancelling…' : 'Cancel subscription'}
                </button>
              </div>
            </div>
          ) : mode === 'plan' ? (
            <div className="space-y-4">
              {currentPlanLabel && <p className="text-xs text-[var(--color-sh-ink-muted)]">Current plan: <span className="font-semibold text-[var(--color-sh-ink)]">{currentPlanLabel}</span></p>}
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-faint)]">New plan</span>
                <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="sh-input mt-1">
                  <option value="">{planOptionsQ.isLoading ? 'Loading plans…' : 'Select a plan…'}</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.id === currentPlanId}>
                      {planLabel(p)}{p.daily_hours != null ? ` — ${p.daily_hours}h/day` : ''}{p.id === currentPlanId ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-faint)]">New monthly price (optional)</span>
                <input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="Keep current price" className="sh-input mt-1" />
              </label>
              <button onClick={() => changePlan.mutate()} disabled={!planId || busy} className="sh-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed">
                {changePlan.isPending ? 'Applying…' : 'Apply plan change'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Reposted cards are already in Published — Broadcast lives there;
                  here we only hand-pick a direct assignment. */}
              {!isPublished && (
                <div className="sh-card px-4 py-3">
                  <p className="text-sm font-semibold text-[var(--color-sh-ink)]">Don't have a replacement yet?</p>
                  <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">Reopen the call to the matching pool and re-broadcast so new candidates can accept. The old talent is released as of the effective date.</p>
                  <button onClick={() => findNewTalent.mutate()} disabled={busy} className="sh-btn-primary sh-btn-primary-sm mt-2 disabled:opacity-50">
                    {findNewTalent.isPending ? 'Reopening…' : 'Find a new talent (rebroadcast)'}
                  </button>
                </div>
              )}

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-sh-ink-faint)]">{isPublished ? 'Hand-pick a talent or partner to assign' : 'Or hand-pick a known replacement (no rebroadcast)'}</p>
                <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search talents and partners…" className="sh-input" />
                <div className="mt-3 space-y-1.5">
                  {talents.map((t) => (
                    <button key={`t-${t.id}`} disabled={busy} onClick={() => changeTalent.mutate({ recipient_type: 'talent', recipient_id: t.id, recipient_name: t.name || undefined, recipient_email: t.email || undefined })} className="sh-card sh-card-interactive flex w-full items-center justify-between px-4 py-2.5 text-left disabled:opacity-50">
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--color-sh-ink)]">{t.name}</span>{t.email && <span className="block truncate text-[11px] text-[var(--color-sh-ink-faint)]">{t.email}</span>}</span>
                      <span className="shrink-0 rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-semibold text-[#1E40AF]">Talent</span>
                    </button>
                  ))}
                  {partners.map((p) => (
                    <button key={`p-${p.id}`} disabled={busy} onClick={() => changeTalent.mutate({ recipient_type: 'partner', recipient_id: p.id, recipient_name: p.name || undefined, recipient_email: p.email || undefined })} className="sh-card sh-card-interactive flex w-full items-center justify-between px-4 py-2.5 text-left disabled:opacity-50">
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--color-sh-ink)]">{p.name}</span>{p.email && <span className="block truncate text-[11px] text-[var(--color-sh-ink-faint)]">{p.email}</span>}</span>
                      <span className="shrink-0 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-semibold text-[#166534]">Partner</span>
                    </button>
                  ))}
                  {debounced.length > 0 && talents.length === 0 && partners.length === 0 && !talentsQ.isLoading && (
                    <p className="px-1 py-2 text-xs text-[var(--color-sh-ink-muted)]">No matches.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
