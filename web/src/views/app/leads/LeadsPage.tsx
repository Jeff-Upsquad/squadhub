'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AdminJobCards from '@/views/admin/jobs/AdminJobCards';
import AdminSubscriptionCards from '@/views/admin/AdminSubscriptionCards';
import { useLeadBadges, type LeadBadge } from './useLeadBadges';

/**
 * Leads — the team-facing home for new deals.
 *
 * The three sections are the admin panel's own pipeline modules, rendered from
 * the same source rather than reimplemented (web/next.config.mjs points `@` at
 * admin/src as a fallback root). So the team gets the real thing — brief forms,
 * broadcast, recipients funnel, candidates, interviews, offers — and there is
 * only ever one implementation to maintain.
 *
 * Access is the `leads` mini app; every endpoint those modules call is gated by
 * requireMiniAppOrAdmin('leads') server-side.
 */

const TABS = [
  { id: 'job-cards', label: 'Job Cards' },
  { id: 'subscription-cards', label: 'Subscription Cards' },
  { id: 'assignments', label: 'Assignments' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Which tab a `?leadTab=` value selects; anything unrecognised falls back. */
function tabFromParam(value: string | null): TabId {
  return TABS.some((t) => t.id === value) ? (value as TabId) : 'job-cards';
}

function AttentionBadge({ badge }: { badge: LeadBadge }) {
  if (badge.total === 0) return null;
  return (
    <span
      // The tooltip is what makes the number actionable — "5" alone doesn't say
      // whether it's five new deals or five cards waiting to be assigned.
      title={badge.parts.join(' · ')}
      className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-[18px] text-white"
      style={{ background: 'var(--color-sh-warning)' }}
    >
      {badge.total > 99 ? '99+' : badge.total}
    </span>
  );
}

export default function LeadsPage() {
  const badges = useLeadBadges();

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // The tab lives in the URL alongside the module's own `?card=<id>`. That
  // makes a lead deep-linkable ("look at this one") and, more importantly,
  // keeps the pair consistent: a reload restores the tab that owns the open
  // card. Without it, a URL carrying `?card=` always reopened on Job Cards,
  // which would sit on "Loading card…" forever for a subscription card.
  const activeTab = tabFromParam(searchParams.get('leadTab'));

  // Card ids belong to exactly one pipeline, so switching tabs drops the
  // param rather than handing it to a module that can't resolve it.
  const switchTab = useCallback(
    (next: TabId) => {
      if (next === activeTab) return;
      router.replace(`${pathname}?leadTab=${next}`);
    },
    [activeTab, pathname, router],
  );

  return (
    <div className="flex h-full min-h-0 flex-col sh-surface">
      <div className="shrink-0 border-b border-[var(--color-sh-warm-border)] px-6 pt-5 pb-3">
        <h1 className="sh-display text-[22px] leading-none">Leads</h1>
        <p className="mt-1.5 text-[13px] text-[var(--color-sh-ink-muted)]">
          Every new deal across hiring, subscriptions and freelance assignments.
        </p>

        <div className="sh-tab-bar mt-3.5 max-w-full overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchTab(tab.id)}
              data-active={activeTab === tab.id}
              className="sh-tab"
            >
              {tab.label}
              <AttentionBadge badge={badges[tab.id]} />
            </button>
          ))}
        </div>
      </div>

      {/*
        Modules are swapped, not kept mounted: each owns a `?card=` URL param and
        a tall list query, so keeping all three alive would have them fight over
        the same param and triple the polling.
      */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'job-cards' && <AdminJobCards />}
        {activeTab === 'subscription-cards' && <AdminSubscriptionCards productLine="subscription" />}
        {activeTab === 'assignments' && <AdminSubscriptionCards productLine="assignment" />}
      </div>
    </div>
  );
}
