'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AdminJobCards from '@/views/admin/jobs/AdminJobCards';
import AdminSubscriptionCards from '@/views/admin/AdminSubscriptionCards';
import { useLeadBadges, type LeadBadge } from '@/views/admin/useLeadBadges';

/**
 * Cards hub — one place for the three deal pipelines.
 *
 * Shared by the admin panel and the Leads mini app. Product tabs sit on top
 * (Subscription / Assignment / Job); each module renders its own status
 * subtabs underneath. Same source modules either way, so there is only one
 * implementation of brief forms, broadcast, recipients, candidates, etc.
 *
 * Access: admin panel is admin-gated; the Leads mini app is the `leads` app
 * and every endpoint those modules call is requireMiniAppOrAdmin('leads').
 */

export const CARD_TABS = [
  { id: 'subscription-cards', label: 'Subscription Cards' },
  { id: 'assignments', label: 'Assignment Cards' },
  { id: 'job-cards', label: 'Job Cards' },
] as const;

export type CardTabId = (typeof CARD_TABS)[number]['id'];

const ADMIN_TAB_PATHS: Record<CardTabId, string> = {
  'subscription-cards': '/admin/subscription-cards',
  assignments: '/admin/assignments',
  'job-cards': '/admin/job-cards',
};

/** Path → tab for the three admin card routes. null outside those routes. */
function tabFromPath(pathname: string): CardTabId | null {
  if (pathname === '/admin/job-cards' || pathname.startsWith('/admin/job-cards/')) return 'job-cards';
  if (pathname === '/admin/assignments' || pathname.startsWith('/admin/assignments/')) return 'assignments';
  if (
    pathname === '/admin/subscription-cards' ||
    pathname.startsWith('/admin/subscription-cards/')
  ) {
    return 'subscription-cards';
  }
  return null;
}

/** Which tab a `?leadTab=` value selects; anything unrecognised falls back. */
function tabFromParam(value: string | null): CardTabId | null {
  return CARD_TABS.some((t) => t.id === value) ? (value as CardTabId) : null;
}

function AttentionBadge({ badge }: { badge: LeadBadge }) {
  if (badge.total === 0) return null;
  return (
    <span
      // The tooltip is what makes the number actionable — "5" alone doesn't say
      // whether it's five new deals or five cards waiting to be assigned.
      title={badge.parts.join(' · ')}
      className="ml-1 inline-flex min-w-[14px] items-center justify-center rounded-full px-1 text-[9px] font-bold leading-[14px] text-white"
      style={{ background: 'var(--color-sh-warning)' }}
    >
      {badge.total > 99 ? '99+' : badge.total}
    </span>
  );
}

export default function CardsHub({
  title,
  defaultTab = 'subscription-cards',
}: {
  /** Optional compact title to the left of the product tabs (Leads mini app). */
  title?: string;
  /** Tab used when the URL doesn't already pick one. */
  defaultTab?: CardTabId;
} = {}) {
  const badges = useLeadBadges();

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Prefer the admin path (so /admin/job-cards lands on Job Cards), then the
  // Leads mini app's ?leadTab=, then the caller's default.
  const pathTab = tabFromPath(pathname);
  const activeTab = pathTab ?? tabFromParam(searchParams.get('leadTab')) ?? defaultTab;

  // Card ids belong to exactly one pipeline, so switching tabs drops the
  // param rather than handing it to a module that can't resolve it.
  const switchTab = useCallback(
    (next: CardTabId) => {
      if (next === activeTab) return;
      if (pathTab) {
        router.replace(ADMIN_TAB_PATHS[next]);
        return;
      }
      router.replace(`${pathname}?leadTab=${next}`);
    },
    [activeTab, pathTab, pathname, router],
  );

  // Hide the product tabs while a card is open — the module already drops its
  // own chrome, and the two-level tab bar would steal space from the detail.
  const cardOpen = !!searchParams.get('card');

  return (
    <div className="flex h-full min-h-0 flex-col sh-surface">
      {!cardOpen && (
        <div className="shrink-0 px-6 pt-3.5 pb-0">
          <div className="flex items-center gap-2.5">
            {title && (
              <h1 className="sh-display shrink-0 text-[15px] leading-none">{title}</h1>
            )}
            <div className="sh-tab-bar sh-tab-bar-sm max-w-full overflow-x-auto">
              {CARD_TABS.map((tab) => (
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
        </div>
      )}

      {/*
        Modules are swapped, not kept mounted: each owns a `?card=` URL param and
        a tall list query, so keeping all three alive would have them fight over
        the same param and triple the polling.
      */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'subscription-cards' && <AdminSubscriptionCards productLine="subscription" compact />}
        {activeTab === 'assignments' && <AdminSubscriptionCards productLine="assignment" compact />}
        {activeTab === 'job-cards' && <AdminJobCards compact />}
      </div>
    </div>
  );
}
