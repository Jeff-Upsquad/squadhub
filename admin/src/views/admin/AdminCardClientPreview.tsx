'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useSquadhireConfig } from '@/hooks/useSquadhireConfig';
import { resolveFinalizedPrice } from '@squadhub/shared';
import CardViewToggle, { type CardViewMode } from './CardViewToggle';
import {
  buildUnifiedRecipients,
  formatRelative,
  type UnifiedRecipient,
} from './AdminSubscriptionCardRecipientsView';
import type { RecipientsResponse } from './AdminSubscriptionCardRecipientsPanel';
import type { AdminSubscriptionCard } from './AdminSubscriptionCards';

// ─── The SquadHire business "review" view, mirrored for admins ───────────────
// After a card is broadcast, the business (client) sees a curated review screen
// in SquadHire: the card's brief up top, then Assigned / Selected / Shortlisted
// / "New talents for review" sections of accepted talents. This component
// reproduces that exact layout on the admin side so an admin can see precisely
// what the client sees — with one privileged difference: admins ALSO see the
// talents who are still Pending (haven't responded to the broadcast), which the
// business is never shown. The view is read-only: the admin drives selection /
// assignment from the "Admin" funnel view, not here.

// The full talent list SquadHire holds for a card (includes not-yet-responded
// pending talents). Same shape the funnel view fetches — cache is shared.
type SquadHireTalent = {
  talent_user_id: string;
  talent_name: string;
  status: 'pending' | 'accepted' | 'rejected';
  responded_at: string | null;
  created_at: string;
  email?: string | null;
  business_review_status?: 'shortlisted' | 'rejected' | null;
  selected_at?: string | null;
  passed_over_at?: string | null;
};

function initials(name: string | undefined | null): string {
  if (!name) return 'T';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'T';
}

export default function AdminCardClientPreview({
  card,
  title,
  onBack,
  onOpenPanel,
  viewMode,
  onSetViewMode,
  tierTabs,
}: {
  card: AdminSubscriptionCard;
  title: string;
  onBack: () => void;
  onOpenPanel: () => void;
  viewMode: CardViewMode;
  onSetViewMode: (m: CardViewMode) => void;
  tierTabs?: React.ReactNode;
}) {
  const { adminUrl } = useSquadhireConfig();

  // Reuse the SAME query keys the funnel view uses, so the React Query cache is
  // shared: opening either view warms the other, and no request is duplicated.
  const { data, isLoading } = useQuery({
    queryKey: ['admin-card-recipients', card.id],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${card.id}/recipients`).then((r) => r.data?.data as RecipientsResponse),
  });

  const hasSquadHireCategories = Array.isArray(card.squadhire_category_ids) && card.squadhire_category_ids.length > 0;
  const { data: shRecipientsRes } = useQuery({
    queryKey: ['admin-card-squadhire-recipients', card.id],
    queryFn: () =>
      api.get(`/admin/subscription-cards/${card.id}/squadhire-recipients`).then(
        (r) => r.data as { data: SquadHireTalent[] },
      ),
    enabled: hasSquadHireCategories,
  });
  const squadhireTalents: SquadHireTalent[] = useMemo(() => shRecipientsRes?.data || [], [shRecipientsRes]);

  const allRecipients = useMemo<UnifiedRecipient[]>(
    () => buildUnifiedRecipients(data, squadhireTalents, card),
    [data, squadhireTalents, card],
  );

  // ─── Funnel buckets, mirroring SubscriptionCardReview.tsx ──────────────────
  // Assigned = the card's confirmed pick. Selected = business picked, pending
  // admin confirmation. Shortlisted / review = accepted talents the business is
  // curating. Pending = accepted-broadcast not-yet-answered — ADMIN-ONLY.
  const assigned = useMemo(() => allRecipients.filter((r) => r.assigned), [allRecipients]);
  const selectedPending = useMemo(
    () => allRecipients.filter((r) => r.selected_at && !r.assigned),
    [allRecipients],
  );
  const shortlisted = useMemo(
    () =>
      allRecipients.filter(
        (r) => r.status === 'accepted' && r.business_review_status === 'shortlisted' && !r.selected_at && !r.assigned,
      ),
    [allRecipients],
  );
  // "New talents for review" — accepted, not yet shortlisted/rejected by the
  // business, not selected. Mirrors the business `forReview` filter (which hides
  // business-passed-over talents), so this is exactly the client's review pool.
  const forReview = useMemo(
    () =>
      allRecipients.filter(
        (r) => r.status === 'accepted' && !r.business_review_status && !r.selected_at && !r.assigned,
      ),
    [allRecipients],
  );
  // Admin-only: talents still awaiting a broadcast response. The business never
  // sees these; admins do.
  const pending = useMemo(() => allRecipients.filter((r) => r.status === 'pending'), [allRecipients]);

  // ─── Card brief header, derived from the admin card (no extra fetch) ────────
  const isAssignment = card.card_type === 'assignment';
  const plan = card.submission_subscription?.plan;
  const planPrice = plan?.pricing?.[0];
  const priceCurrency = planPrice?.country?.currency || card.submission?.country?.currency || '';
  const cur = priceCurrency || '₹';
  const finalizedPrice = resolveFinalizedPrice(card);
  const priceDisplay =
    finalizedPrice != null ? `${cur} ${finalizedPrice.toLocaleString()}${isAssignment ? '' : '/mo'}` : null;

  const serviceDisplay = card.submission_subscription?.subscription?.name || card.service_type || null;
  const planNameDisplay = plan?.plan || card.plan_name || null;
  const tiers = Array.isArray(card.target_tiers) ? card.target_tiers : [];
  const hoursDeliverable = (card.plan_default_deliverables || []).find((d) => d.kind === 'hours');
  const planHours = hoursDeliverable
    ? [
        hoursDeliverable.per_day ? `${hoursDeliverable.per_day} hrs/day` : null,
        hoursDeliverable.per_week ? `${hoursDeliverable.per_week} hrs/week` : null,
        hoursDeliverable.per_month ? `${hoursDeliverable.per_month} hrs/month` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null
    : null;
  const regions = (card.target_regions || []).map((r) => r.region).filter(Boolean);
  const languages = card.target_languages || [];
  const workingDays = card.working_days || [];
  const customDeliverables = card.custom_deliverables || [];
  const timeline = card.assignment_details ?? null;
  const description = card.notes ?? null;
  const isClosed = !!card.archived_at || !!card.cancelled_at || !!card.recalled_at || card.state === 'closed';

  const headerRow = (
    <div className="flex items-center justify-between gap-3">
      <button onClick={onBack} className="sh-btn-ghost sh-btn-ghost-sm">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Subscription Cards
      </button>
      <div className="flex items-center gap-2">
        <CardViewToggle viewMode={viewMode} onSetViewMode={onSetViewMode} />
        <button onClick={onOpenPanel} className="sh-btn-ghost sh-btn-ghost-sm">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
            />
          </svg>
          Card Details
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 pt-6 pb-10">
        {headerRow}

        {/* A subtle banner clarifying this is the client's-eye view. */}
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] px-4 py-2.5">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-sh-ink-subtle)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <p className="text-xs text-[var(--color-sh-ink-muted)]">
            This is the read-only view the client sees for this card in SquadHire. As an admin you also
            see <span className="font-semibold">Pending</span> talents (still awaiting a response) — the client does not.
          </p>
        </div>

        {/* ═══ Card brief ═══ */}
        <div className="sh-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-[family-name:var(--font-jakarta)] text-lg font-semibold text-[var(--color-sh-ink)]">
                {title}
              </h1>
              {planNameDisplay && <p className="mt-0.5 text-sm text-[var(--color-sh-ink-subtle)]">{planNameDisplay}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isClosed && (
                <span className="rounded-full bg-[var(--color-sh-cream)] px-3 py-1 text-xs font-semibold text-[var(--color-sh-ink-subtle)]">
                  {card.recalled_at ? 'Recalled' : 'Closed'}
                </span>
              )}
              {priceDisplay && (
                <span className="rounded-full bg-[var(--color-sh-lime-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-sh-ink)]">
                  {priceDisplay}
                </span>
              )}
            </div>
          </div>

          {(serviceDisplay || tiers.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {serviceDisplay && (
                <span className="rounded-full bg-[var(--color-sh-cream)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-sh-ink)]">
                  {serviceDisplay}
                </span>
              )}
              {tiers.map((t) => (
                <span key={t} className="rounded-full bg-[var(--color-sh-cream)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-sh-ink)]">
                  {t}
                </span>
              ))}
            </div>
          )}

          <Section title={isAssignment ? 'Assignment' : 'Subscription'}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {serviceDisplay && <DetailRow label="Service">{serviceDisplay}</DetailRow>}
              {planNameDisplay && <DetailRow label="Plan">{planNameDisplay}</DetailRow>}
              {tiers.length > 0 && (
                <DetailRow label={tiers.length === 1 ? 'Tier' : 'Tiers'}>{tiers.join(', ')}</DetailRow>
              )}
              {planHours && <DetailRow label="Availability">{planHours}</DetailRow>}
              {!isAssignment && workingDays.length > 0 && (
                <DetailRow label="Working days">{workingDays.join(', ')}</DetailRow>
              )}
            </dl>
            {customDeliverables.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-sh-ink-faint)]">
                  Custom deliverables
                </p>
                <ul className="mt-1.5 space-y-1 text-sm text-[var(--color-sh-ink)]">
                  {customDeliverables.map((d, i) => {
                    const cadence = [
                      d.per_day ? `${d.per_day}/day` : null,
                      d.per_week ? `${d.per_week}/week` : null,
                      d.per_month ? `${d.per_month}/month` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <li key={d.id ?? i} className="flex items-baseline gap-2">
                        <span className="font-medium">{d.name || '—'}</span>
                        {cadence && <span className="text-xs text-[var(--color-sh-ink-subtle)]">{cadence}</span>}
                        {d.kind && <span className="text-[10px] uppercase text-[var(--color-sh-ink-faint)]">{d.kind}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Section>

          {(regions.length > 0 || languages.length > 0) && (
            <Section title="Location & languages">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {regions.length > 0 && (
                  <DetailRow label={regions.length === 1 ? 'Region' : 'Regions'}>{regions.join(', ')}</DetailRow>
                )}
                {languages.length > 0 && (
                  <DetailRow label={languages.length === 1 ? 'Language' : 'Languages'}>{languages.join(', ')}</DetailRow>
                )}
              </dl>
            </Section>
          )}

          {priceDisplay && (
            <Section title={isAssignment ? 'Project budget' : 'Budget'}>
              <p className="text-lg font-semibold text-[var(--color-sh-ink)]">{priceDisplay}</p>
            </Section>
          )}

          {isAssignment && timeline && (timeline.duration || timeline.start_date || timeline.deadline) && (
            <Section title="Timeline">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {timeline.duration && <DetailRow label="Duration">{timeline.duration}</DetailRow>}
                {timeline.start_date && <DetailRow label="Start date">{timeline.start_date}</DetailRow>}
                {timeline.deadline && <DetailRow label="Deadline">{timeline.deadline}</DetailRow>}
              </dl>
            </Section>
          )}

          {isAssignment && description && (
            <Section title="Scope & deliverables">
              <p className="whitespace-pre-line text-sm text-[var(--color-sh-ink-muted)]">{description}</p>
            </Section>
          )}

          {(card.brand_name || card.business_nature || card.customer_location || (!isAssignment && description)) && (
            <Section title="About the brand">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {card.brand_name && card.brand_name !== card.customer_company && (
                  <DetailRow label="Brand">{card.brand_name}</DetailRow>
                )}
                {card.business_nature && <DetailRow label="Nature of business">{card.business_nature}</DetailRow>}
                {card.customer_location && <DetailRow label="Location of business">{card.customer_location}</DetailRow>}
              </dl>
              {!isAssignment && description && (
                <p className="mt-3 whitespace-pre-line text-sm text-[var(--color-sh-ink-muted)]">{description}</p>
              )}
            </Section>
          )}
        </div>

        {/* ═══ Assigned talent(s) — confirmed pick (emerald) ═══ */}
        {assigned.length > 0 && (
          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-5 sm:p-6 dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <h2 className="mb-3 flex items-center gap-2 font-[family-name:var(--font-jakarta)] text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {assigned.length === 1 ? 'Assigned Talent' : 'Assigned Talents'}
            </h2>
            <div className="space-y-3">
              {assigned.map((r) => (
                <RecipientRow key={`${r.type}-${r.id}`} r={r} adminUrl={adminUrl} rightPill={{ label: 'Assigned', tone: 'emerald' }} />
              ))}
            </div>
          </div>
        )}

        {/* ═══ Selected — pending confirmation (amber) ═══ */}
        {selectedPending.length > 0 && (
          <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-5 sm:p-6 dark:border-amber-900/50 dark:bg-amber-950/20">
            <h2 className="mb-1 flex items-center gap-2 font-[family-name:var(--font-jakarta)] text-sm font-semibold text-amber-800 dark:text-amber-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Selected — pending confirmation
            </h2>
            <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
              The client picked this talent; it&rsquo;s awaiting admin confirmation to activate.
            </p>
            <div className="space-y-3">
              {selectedPending.map((r) => (
                <RecipientRow key={`${r.type}-${r.id}`} r={r} adminUrl={adminUrl} rightPill={{ label: 'Selected', tone: 'amber' }} />
              ))}
            </div>
          </div>
        )}

        {/* Tier sub-tabs (multi-tier briefs) — switches the active tier card. */}
        {tierTabs && <div>{tierTabs}</div>}

        {/* ═══ Shortlisted ═══ */}
        <ListCard title="Shortlisted" count={shortlisted.length} emptyText="No shortlisted talents yet.">
          {shortlisted.map((r) => (
            <RecipientRow key={`${r.type}-${r.id}`} r={r} adminUrl={adminUrl} rightPill={{ label: 'Shortlisted', tone: 'violet' }} />
          ))}
        </ListCard>

        {/* ═══ New talents for review ═══ */}
        <ListCard
          title="New talents for review"
          count={forReview.length}
          loading={isLoading}
          emptyText="No new talents to review."
        >
          {forReview.map((r) => (
            <RecipientRow
              key={`${r.type}-${r.id}`}
              r={r}
              adminUrl={adminUrl}
              rightText={r.responded_at ? `Accepted ${formatRelative(r.responded_at)}` : 'Accepted'}
            />
          ))}
        </ListCard>

        {/* ═══ Pending — awaiting response (ADMIN-ONLY) ═══ */}
        <ListCard
          title="Pending — awaiting response"
          count={pending.length}
          adminOnly
          emptyText="No talents are awaiting a response."
        >
          {pending.map((r) => (
            <RecipientRow
              key={`${r.type}-${r.id}`}
              r={r}
              adminUrl={adminUrl}
              muted
              rightPill={{ label: 'Pending', tone: 'slate' }}
            />
          ))}
        </ListCard>
      </div>
    </div>
  );
}

// ─── Presentational helpers ──────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 border-t border-[var(--color-sh-warm-border)] pt-3">
      <h2 className="mb-1.5 font-[family-name:var(--font-jakarta)] text-[13px] font-semibold text-[var(--color-sh-ink)]">
        {title}
      </h2>
      {children}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-sh-ink-faint)]">{label}</dt>
      <dd className="text-sm text-[var(--color-sh-ink)]">{children}</dd>
    </div>
  );
}

// A titled list card matching the business review sections. `adminOnly` tags the
// section with a small badge (the client never sees it); `loading` shows a
// skeleton; empty renders `emptyText`.
function ListCard({
  title,
  count,
  children,
  emptyText,
  loading = false,
  adminOnly = false,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  emptyText: string;
  loading?: boolean;
  adminOnly?: boolean;
}) {
  return (
    <div className="sh-card">
      <div className="flex items-center justify-between border-b border-[var(--color-sh-warm-border)] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <h2 className="font-[family-name:var(--font-jakarta)] text-sm font-semibold text-[var(--color-sh-ink)]">
            {title}
          </h2>
          {adminOnly && (
            <span className="rounded-full bg-[#EEF2F6] px-2 py-0.5 text-[10px] font-semibold text-[#475569] dark:bg-slate-800 dark:text-slate-300">
              Admin only
            </span>
          )}
        </div>
        <span className="text-xs text-[var(--color-sh-ink-faint)]">{count} total</span>
      </div>
      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-[var(--color-sh-cream)]" />
          ))}
        </div>
      ) : count === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-[var(--color-sh-ink-subtle)]">{emptyText}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-sh-warm-border)]">{children}</ul>
      )}
    </div>
  );
}

const PILL_TONES: Record<string, { bg: string; color: string }> = {
  emerald: { bg: '#D1FAE5', color: '#065F46' },
  amber: { bg: '#FEF3C7', color: '#92400E' },
  violet: { bg: '#EDE9FE', color: '#6D28D9' },
  slate: { bg: '#EEF2F6', color: '#475569' },
};

function RecipientRow({
  r,
  adminUrl,
  rightPill,
  rightText,
  muted = false,
}: {
  r: UnifiedRecipient;
  adminUrl: string | null | undefined;
  rightPill?: { label: string; tone: keyof typeof PILL_TONES | string };
  rightText?: string;
  muted?: boolean;
}) {
  const tone = rightPill ? PILL_TONES[rightPill.tone] ?? PILL_TONES.slate : null;
  const isTalent = r.type === 'talent';
  const profileHref = isTalent && adminUrl ? `${adminUrl}/admin/users/${r.id}` : null;
  return (
    <li className={`px-5 py-3 sm:px-6 ${muted ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-sh-lime-soft)] font-[family-name:var(--font-jakarta)] text-sm font-semibold text-[var(--color-sh-ink)] ring-1 ring-[var(--color-sh-warm-border)]">
          {initials(r.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-[family-name:var(--font-jakarta)] text-[15px] font-semibold text-[var(--color-sh-ink)]">
              {r.name || 'Unknown talent'}
            </p>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={isTalent ? { backgroundColor: '#F2EBFE', color: '#6B21A8' } : { backgroundColor: '#DBEAFE', color: '#1E40AF' }}
            >
              {isTalent ? 'Talent' : 'Partner'}
            </span>
          </div>
          {rightText && <p className="mt-0.5 truncate text-xs text-[var(--color-sh-ink-faint)]">{rightText}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {tone && (
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: tone.bg, color: tone.color }}
            >
              {rightPill!.label}
            </span>
          )}
          {profileHref && (
            <a
              href={profileHref}
              target="_blank"
              rel="noopener noreferrer"
              title="View profile in SquadHire"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-sh-ink-faint)] transition hover:bg-[var(--color-sh-cream)] hover:text-[var(--color-sh-ink)]"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
