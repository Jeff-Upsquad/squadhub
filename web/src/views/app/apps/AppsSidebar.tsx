import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import type { HomeView } from '../../../layouts/MainLayout';
import { APP_CATEGORY_ORDER, AppIcon, type AppDef } from '../../../config/apps';
import { useAvailableApps } from '../../../hooks/useApps';
import { useAppFavorites, useToggleAppFavorite } from '../../../hooks/useAppFavorites';
import { useActiveTipAnchor } from '../../../stores/featureTipStore';
import { useTabsStore } from '../../../stores/tabsStore';
import { useCardsAttention } from '@/views/admin/useCardsAttention';
import { wantsNewTab, buildAppSnapshot } from '../../../lib/tabSnapshots';

// Module side menu bar shown when the Apps rail module is active. Lists the
// apps the user can access, grouped by category, in the same list style as the
// home sidebar. Clicking a row opens the app in the content panel; the star
// pins it to the home sidebar's Apps section.

interface AppsSidebarProps {
  /** The currently-open app view (highlights the matching row). */
  activeView: HomeView;
  /** Open an app in the content panel (internal view or SSO link-out). */
  onOpenApp: (app: AppDef) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavBack: () => void;
  onNavForward: () => void;
}

// Category eyebrow header with collapse toggle — mirrors the home sidebar's.
function CategoryHeader({
  title,
  collapsed,
  onToggle,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 pt-3 pb-1">
      <button
        onClick={onToggle}
        className="flex h-4 w-4 items-center justify-center text-[var(--sh-ink-4)] transition-colors hover:text-[var(--sh-ink)]"
        aria-label={collapsed ? 'Expand' : 'Collapse'}
      >
        <svg
          className={`h-3 w-3 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          viewBox="0 0 18 18"
          fill="currentColor"
        >
          <path d="M5 7h8L9 11z" />
        </svg>
      </button>
      <button
        onClick={onToggle}
        className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--sh-ink-4)] transition-colors hover:text-[var(--sh-ink)]"
      >
        {title}
      </button>
    </div>
  );
}

function groupByCategory(apps: AppDef[]) {
  const byCategory = new Map<string, AppDef[]>();
  for (const app of apps) {
    const list = byCategory.get(app.category) ?? [];
    list.push(app);
    byCategory.set(app.category, list);
  }
  const order = [...APP_CATEGORY_ORDER];
  const sorted = [...byCategory.keys()].sort((a, b) => {
    const ia = order.indexOf(a as (typeof APP_CATEGORY_ORDER)[number]);
    const ib = order.indexOf(b as (typeof APP_CATEGORY_ORDER)[number]);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return sorted.map((category) => ({ category, apps: byCategory.get(category)! }));
}

export default function AppsSidebar({
  activeView,
  onOpenApp,
  canGoBack,
  canGoForward,
  onNavBack,
  onNavForward,
}: AppsSidebarProps) {
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const apps = useAvailableApps();
  const { data: favorites = [] } = useAppFavorites();
  const toggleFavorite = useToggleAppFavorite();

  const groups = useMemo(() => groupByCategory(apps), [apps]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // While a feature tip spotlights the star (the "pin your apps" tour), surface
  // the otherwise hover-only star on the first app so the coachmark has a stable,
  // visible target to point at.
  const activeAnchor = useActiveTipAnchor();
  const tourStar = activeAnchor === 'apps.star';
  const firstAppSlug = groups[0]?.apps[0]?.slug ?? null;

  // Requirement Cards is the one app with a queue behind it, so its row carries
  // how much is waiting. Only fetched when the user actually has the app —
  // everyone else would just collect a 403.
  const hasCards = apps.some((a) => a.slug === 'leads');
  const cardsAttention = useCardsAttention(hasCards);

  return (
    <div className="flex h-full w-full flex-col text-[var(--sh-ink-2)]">
      {/* Header — mirrors the home sidebar */}
      <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="grid h-[22px] w-[22px] place-items-center rounded-[6px] bg-[var(--sh-ink)] text-[var(--sidebar)]"
            style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', fontSize: 12, fontWeight: 700 }}
          >
            {(currentWorkspace?.name || 'S').charAt(0).toUpperCase()}
          </span>
          <span className="text-[13.5px] font-semibold text-[var(--sh-ink)]">Apps</span>
        </div>
        <div className="flex items-center gap-[2px]">
          <button
            onClick={onNavBack}
            disabled={!canGoBack}
            className="grid h-[26px] w-[26px] place-items-center rounded-[6px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] disabled:pointer-events-none disabled:opacity-35"
            title="Back"
            aria-label="Go back"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={onNavForward}
            disabled={!canGoForward}
            className="grid h-[26px] w-[26px] place-items-center rounded-[6px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] disabled:pointer-events-none disabled:opacity-35"
            title="Forward"
            aria-label="Go forward"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* App list — grouped by category */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {apps.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-[var(--sh-ink-4)]">No apps available yet</p>
        ) : (
          groups.map(({ category, apps: catApps }) => {
            const isCollapsed = !!collapsed[category];
            return (
              <div key={category} className="pb-1">
                <CategoryHeader
                  title={category}
                  collapsed={isCollapsed}
                  onToggle={() => setCollapsed((c) => ({ ...c, [category]: !c[category] }))}
                />
                {!isCollapsed &&
                  catApps.map((app) => {
                    const active = !!app.view && activeView === app.view;
                    const pinned = favorites.includes(app.slug);
                    const spotlightStar = tourStar && app.slug === firstAppSlug;
                    return (
                      <div key={app.slug} className="group flex items-center">
                        <button
                          onClick={(e) => {
                            if (app.view && wantsNewTab(e)) {
                              e.preventDefault();
                              useTabsStore.getState().openInNewTab(buildAppSnapshot(app.view, 'apps'), { background: e.button === 1 });
                              return;
                            }
                            onOpenApp(app);
                          }}
                          onAuxClick={(e) => {
                            if (e.button === 1 && app.view) {
                              e.preventDefault();
                              useTabsStore.getState().openInNewTab(buildAppSnapshot(app.view, 'apps'), { background: true });
                            }
                          }}
                          className={`mb-[1px] flex flex-1 items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
                            active
                              ? 'border border-[var(--sh-hair)] bg-[var(--surface)] font-medium text-[var(--sh-ink)]'
                              : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
                          }`}
                          style={active ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
                        >
                          <AppIcon
                            paths={app.paths}
                            className={`h-[14px] w-[14px] shrink-0 ${active ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`}
                          />
                          <span className="flex-1 truncate">{app.name}</span>
                          {app.slug === 'leads' && cardsAttention.total > 0 && (
                            <span
                              title={cardsAttention.parts.join(' · ')}
                              className="shrink-0 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[9.5px] font-bold leading-4 text-white"
                              style={{ background: 'var(--color-sh-warning)' }}
                            >
                              {cardsAttention.total > 99 ? '99+' : cardsAttention.total}
                            </span>
                          )}
                          {app.external && (
                            <svg className="h-3 w-3 shrink-0 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite.mutate({ slug: app.slug, favorited: pinned });
                          }}
                          data-tip-anchor={spotlightStar ? 'apps.star' : undefined}
                          title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                          aria-label={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                          aria-pressed={pinned}
                          className={`mr-1 rounded p-0.5 transition ${
                            pinned
                              ? 'text-[var(--sh-warn,#f5a623)]'
                              : spotlightStar
                                ? 'text-[var(--sh-warn,#f5a623)] opacity-100'
                                : 'text-[var(--sh-ink-4)] opacity-0 hover:text-[var(--sh-ink)] group-hover:opacity-100'
                          }`}
                        >
                          <svg className="h-[13px] w-[13px]" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.05 10.8c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
