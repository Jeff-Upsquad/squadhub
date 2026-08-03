import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Channel, SubscriptionCardRecipient } from '@squadhub/shared';
import type { HomeView } from '../../layouts/MainLayout';
import api from '../../services/api';
import { useFavorites, useRemoveFavorite } from '../../hooks/useFavorites';
import { useSharedWithMe } from '../../hooks/useSharedWithMe';
import { useHasPermission } from '../../hooks/usePermissions';
import { usePMStore } from '../../stores/pmStore';
import { useTabsStore } from '../../stores/tabsStore';
import { wantsNewTab, buildListSnapshot, buildFolderSnapshot, buildSpaceSnapshot, buildChatSnapshot, buildAppSnapshot } from '../../lib/tabSnapshots';
import SpaceTree from './pm/SpaceTree';
import CreateSpaceModal from './pm/CreateSpaceModal';
import { useAvailableApps } from '../../hooks/useApps';
import { useAppFavorites, useMigrateLocalAppFavorites } from '../../hooks/useAppFavorites';
import { AppIcon, type AppDef } from '../../config/apps';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useIsClient, useIsPartner } from '../../hooks/useUserType';
import { useDms } from '../../hooks/useDms';
import NewDmModal from './chat/NewDmModal';
import DmListItem from './chat/DmListItem';
import { useCloseCrmChat, useCrmChats } from '../../hooks/useCrmChats';
import { useChatSidePanelStore } from '../../stores/chatSidePanelStore';

// ---- Props ----
interface HomeSidebarProps {
  workspaceId: string;
  channels: Channel[];
  activeChannelId: string | null;
  homeView: HomeView;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavBack: () => void;
  onNavForward: () => void;
  onChangeView: (view: HomeView) => void;
  onSelectChannel: (channelId: string) => void;
  onSelectDm: (dmId: string) => void;
  onCreateChannel: () => void;
  onOpenSpaces: () => void;
  onOpenSearch: () => void;
  /** Open the Apps module (the "browse all apps" tab). */
  onOpenApps: () => void;
  /** Launch an app (internal view or SSO link-out) — owned by MainLayout. */
  onLaunchApp: (app: AppDef) => void;
  /** Inbox notification badge is in its "recent" (red) window. */
  inboxAlert?: boolean;
  /** Inbox notification badge should pulse (just arrived). */
  inboxPulse?: boolean;
}

// ---- Favorite icon helper ----
function FavoriteIcon({ type }: { type: string }) {
  const cls = 'h-[14px] w-[14px] shrink-0 text-[var(--sh-ink-3)]';
  switch (type) {
    case 'channel':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
        </svg>
      );
    case 'list':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      );
    case 'folder':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      );
    case 'space':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      );
    default:
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      );
  }
}

// ---- Sidebar nav item (matches design's sb-item) ----
function NavItem({
  icon,
  label,
  active,
  count,
  unread,
  alert = false,
  pulse = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  count?: number;
  unread?: boolean;
  /** Render the count badge red (a notification arrived recently). */
  alert?: boolean;
  /** Play the expanding pulse ring (a notification just arrived). */
  pulse?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
        active
          ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
          : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
      }`}
      style={active ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
    >
      <span className={active ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count != null && count > 0 && (
        <span className="relative grid place-items-center">
          {alert && pulse && (
            <span
              aria-hidden
              className="sh-badge-ping absolute inset-0 rounded-full"
              style={{ background: 'var(--sh-badge-alert)' }}
            />
          )}
          <span
            className={`relative text-[10.5px] font-semibold rounded-full px-[6px] py-[1px] leading-none ${
              alert
                ? 'text-white'
                : unread
                  ? 'bg-[var(--sh-ink)] text-[var(--sidebar)]'
                  : 'bg-[var(--sh-hair-3)] text-[var(--sh-ink-3)]'
            }`}
            style={{
              fontFamily: 'var(--font-mono, Inter, sans-serif)',
              ...(alert ? { background: 'var(--sh-badge-alert)' } : null),
            }}
          >
            {count}
          </span>
        </span>
      )}
    </button>
  );
}

// ---- Collapsible section header (monochrome eyebrow) ----
function SectionHeader({
  title,
  expanded,
  onToggle,
  action,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="group flex items-center justify-between px-2 pt-3 pb-1">
      <div className="flex items-center gap-1">
        <button
          onClick={onToggle}
          className="flex items-center justify-center h-4 w-4 text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)] transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <svg
            className={`h-3 w-3 transition-transform ${expanded ? '' : '-rotate-90'}`}
            viewBox="0 0 18 18"
            fill="currentColor"
          >
            <path d="M5 7h8L9 11z" />
          </svg>
        </button>
        <button
          onClick={onToggle}
          className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)] whitespace-nowrap transition-colors"
        >
          {title}
        </button>
      </div>
      {action && (
        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
          {action}
        </span>
      )}
    </div>
  );
}

// ---- Main Component ----
export default function HomeSidebar({
  workspaceId,
  channels,
  activeChannelId,
  homeView,
  canGoBack,
  canGoForward,
  onNavBack,
  onNavForward,
  onChangeView,
  onSelectChannel,
  onSelectDm,
  onCreateChannel,
  onOpenSpaces,
  onOpenSearch,
  onOpenApps,
  onLaunchApp,
  inboxAlert = false,
  inboxPulse = false,
}: HomeSidebarProps) {
  const activeChannelKind = useWorkspaceStore((s) => s.activeChannelKind);
  const setDmConversations = useWorkspaceStore((s) => s.setDmConversations);
  const canSendDms = useHasPermission('can_send_dms');
  const [showNewDm, setShowNewDm] = useState(false);
  const { data: dmsData } = useDms(workspaceId);
  const dms = dmsData ?? [];
  // Keep store in sync only when the query data ref actually changes.
  // Avoids feedback loop from defaulting `[]` on every render.
  useEffect(() => {
    if (dmsData) setDmConversations(dmsData);
  }, [dmsData, setDmConversations]);
  const { data: favorites, isLoading: favoritesLoading } = useFavorites(workspaceId);
  const { data: sharedItems, isLoading: sharedLoading } = useSharedWithMe(workspaceId);
  const removeFavorite = useRemoveFavorite(workspaceId);
  const { setActiveSpace, setActiveList, setActiveFolder, setActiveSpacePage } = usePMStore();
  const canCreateChannels = useHasPermission('can_create_channels');
  const canCreateSpaces = useHasPermission('can_create_spaces');
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const isClient = useIsClient();
  const isPartner = useIsPartner();
  // Apps the user can access + their pinned subset (shown in the Apps section).
  const availableApps = useAvailableApps();
  // One-time backfill of any pins saved client-side before server sync existed.
  useMigrateLocalAppFavorites(true);
  const { data: appFavorites = [] } = useAppFavorites();
  const favoriteApps = availableApps.filter((a) => appFavorites.includes(a.slug));
  const { data: inboxUnreadCount } = useUnreadCount();

  const [expandedSections, setExpandedSections] = useState({
    apps: true,
    favorites: true,
    sharedWithMe: true,
    spaces: true,
    channels: true,
    dms: true,
    crmChats: true,
  });
  const { data: crmChats = [] } = useCrmChats(workspaceId);
  const closeCrmChat = useCloseCrmChat(workspaceId);
  const openChatPanel = useChatSidePanelStore((s) => s.open);
  const activePanelChannelId = useChatSidePanelStore((s) => (s.isOpen ? s.channelId : null));

  const toggleSection = (key: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex h-full w-full flex-col text-[var(--sh-ink-2)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-4 py-3">
        {/* Brand lockup — "SquadHub" with a "Powered by UpSquad" subtitle,
            matching the squadhire/login lockup style. */}
        <div className="flex items-center gap-2">
          <span
            className="grid h-[22px] w-[22px] place-items-center rounded-[6px] bg-[var(--sh-ink)] text-[var(--sidebar)]"
            style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', fontSize: 10, fontWeight: 700, letterSpacing: '-0.02em' }}
          >
            SH
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[13.5px] font-semibold text-[var(--sh-ink)]">SquadHub</span>
            <span className="text-[10.5px] text-[var(--sh-ink-3)]">Powered by UpSquad</span>
          </div>
        </div>
        <div className="flex items-center gap-[2px]">
          <button
            onClick={onNavBack}
            disabled={!canGoBack}
            className="grid h-[26px] w-[26px] place-items-center rounded-[6px] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] transition disabled:pointer-events-none disabled:opacity-35"
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
            className="grid h-[26px] w-[26px] place-items-center rounded-[6px] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] transition disabled:pointer-events-none disabled:opacity-35"
            title="Forward"
            aria-label="Go forward"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-2 border-b border-[var(--sh-hair)] relative">
        <svg className="absolute left-[20px] top-1/2 -translate-y-1/2 h-[13px] w-[13px] text-[var(--sh-ink-4)] pointer-events-none z-[1]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <button
          type="button"
          onClick={onOpenSearch}
          className="w-full pl-[30px] pr-10 py-[4px] bg-[var(--surface)] border border-[var(--sh-hair)] rounded-lg text-[12.5px] text-left text-[var(--sh-ink-4)] outline-none hover:border-[var(--sh-ink-4)] focus:border-[var(--sh-ink-4)] transition"
          aria-label="Open workspace search"
        >
          Search or jump to…
        </button>
        <span
          className="absolute right-[18px] top-1/2 -translate-y-1/2 text-[10px] text-[var(--sh-ink-4)] bg-[var(--sh-hair-3)] border border-[var(--sh-hair)] rounded px-[4px] py-[1px] pointer-events-none"
          style={{ fontFamily: 'var(--font-mono, Inter, sans-serif)' }}
        >⌘K</span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Navigation items — design's top list */}
        <div className="px-2 pt-2 pb-1 flex flex-col gap-[1px]">
          <NavItem
            icon={
              <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
              </svg>
            }
            label="My home"
            active={homeView === 'hub'}
            onClick={() => onChangeView('hub')}
          />
          <NavItem
            icon={
              <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M3 13V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" />
                <path d="M3 13h5l2 3h4l2-3h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            }
            label="Inbox"
            active={homeView === 'inbox'}
            count={inboxUnreadCount ?? 0}
            unread
            alert={inboxAlert}
            pulse={inboxPulse}
            onClick={() => onChangeView('inbox')}
          />
          {/* Day Planner + Routines — hidden for client / client-staff users. */}
          {!isClient && (
            <>
              <NavItem
                icon={
                  <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <circle cx="12" cy="13" r="8" />
                    <path d="M12 9v4l2.5 1.5" />
                    <path d="M5 3 3 5M19 3l2 2" />
                  </svg>
                }
                label="Day Planner"
                active={homeView === 'day-planner'}
                onClick={() => onChangeView('day-planner')}
              />
              <NavItem
                icon={
                  <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="m17 2 4 4-4 4" />
                    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                    <path d="m7 22-4-4 4-4" />
                    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                  </svg>
                }
                label="Routines"
                active={homeView === 'routines'}
                onClick={() => onChangeView('routines')}
              />
            </>
          )}
          {/* My Tasks — the user's private personal workspace. Available to all users. */}
          <NavItem
            icon={
              <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="m8.5 12.5 2.5 2.5 4.5-5" />
              </svg>
            }
            label="My Tasks"
            active={homeView === 'my-tasks'}
            onClick={() => onChangeView('my-tasks')}
          />
          {isPartner && (
            <PartnerOpportunitiesLink
              active={homeView === 'opportunities'}
              onClick={() => onChangeView('opportunities')}
            />
          )}
        </div>

        {/* Divider */}
        <div className="mx-2 border-t border-[var(--sh-hair)]" />

        {/* Apps section — pinned apps. Only shown when the user has app access;
            apps are pinned from the Apps module (the rail's grid icon). */}
        {availableApps.length > 0 && (
          <>
            <div className="py-1" data-tip-anchor="home.apps">
              <SectionHeader
                title="Apps"
                expanded={expandedSections.apps}
                onToggle={() => toggleSection('apps')}
                action={
                  <button
                    onClick={onOpenApps}
                    className="text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
                    title="Browse all apps"
                    aria-label="Browse all apps"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  </button>
                }
              />
              {expandedSections.apps && (
                <div className="px-2 pb-1">
                  {favoriteApps.length === 0 ? (
                    <button
                      onClick={onOpenApps}
                      className="w-full px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink-3)]"
                    >
                      Star apps to pin them here
                    </button>
                  ) : (
                    favoriteApps.map((app) => {
                      const active = !!app.view && homeView === app.view;
                      return (
                        <button
                          key={app.slug}
                          onClick={(e) => {
                            if (app.view && wantsNewTab(e)) {
                              e.preventDefault();
                              useTabsStore.getState().openInNewTab(buildAppSnapshot(app.view, 'home'), { background: e.button === 1 });
                              return;
                            }
                            onLaunchApp(app);
                          }}
                          onAuxClick={(e) => { if (e.button === 1 && app.view) { e.preventDefault(); useTabsStore.getState().openInNewTab(buildAppSnapshot(app.view, 'home'), { background: true }); } }}
                          className={`mb-[1px] flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
                            active
                              ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                              : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
                          }`}
                          style={active ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
                        >
                          <AppIcon
                            paths={app.paths}
                            className={`h-[14px] w-[14px] shrink-0 ${active ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`}
                          />
                          <span className="flex-1 truncate">{app.name}</span>
                          {app.external && (
                            <svg className="h-3 w-3 shrink-0 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="mx-2 border-t border-[var(--sh-hair)]" />
          </>
        )}

        {/* Favorites section */}
        <div className="py-1">
          <SectionHeader
            title="Favorites"
            expanded={expandedSections.favorites}
            onToggle={() => toggleSection('favorites')}
          />
          {expandedSections.favorites && (
            <div className="px-2 pb-1">
              {favoritesLoading && (
                <p className="px-2 py-[5px] text-[11.5px] text-[var(--sh-ink-4)]">Loading...</p>
              )}
              {!favoritesLoading && (!favorites || favorites.length === 0) && (
                <p className="px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">
                  Star items to pin them here
                </p>
              )}
              {favorites?.map((fav) => {
                // ⌘/Ctrl-click or middle-click opens the favorite in a new tab.
                const favSnapshot = () => {
                  if (fav.item_type === 'channel') return buildChatSnapshot(fav.item_id, 'channel');
                  if (fav.item_type === 'list') return buildListSnapshot(fav.space_id || '', fav.item_id);
                  if (fav.item_type === 'space') return buildSpaceSnapshot(fav.item_id);
                  if (fav.item_type === 'folder') return buildFolderSnapshot(fav.space_id || '', fav.item_id);
                  return null;
                };
                const openFav = (e?: React.MouseEvent) => {
                  if (e && wantsNewTab(e)) {
                    const snap = favSnapshot();
                    if (snap) {
                      e.preventDefault();
                      useTabsStore.getState().openInNewTab(snap, { background: e.button === 1 });
                      return;
                    }
                  }
                  if (fav.item_type === 'channel') {
                    onSelectChannel(fav.item_id);
                    return;
                  }
                  if (fav.item_type === 'list') {
                    if (fav.space_id) setActiveSpace(fav.space_id);
                    setActiveList(fav.item_id);
                  } else if (fav.item_type === 'space') {
                    setActiveSpace(fav.item_id);
                    setActiveSpacePage(fav.item_id);
                  } else if (fav.item_type === 'folder') {
                    if (fav.space_id) setActiveSpace(fav.space_id);
                    setActiveFolder(fav.item_id);
                  }
                  onChangeView('tasks');
                };
                return (
                <div key={fav.id} className="group flex items-center">
                  <button
                    onClick={openFav}
                    onAuxClick={(e) => { if (e.button === 1) openFav(e); }}
                    className="flex flex-1 items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] text-[var(--sh-ink-2)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                  >
                    <FavoriteIcon type={fav.item_type} />
                    <span className="truncate">{fav.item_name}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFavorite.mutate(fav.id); }}
                    className="mr-1 hidden rounded p-0.5 text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)] group-hover:block"
                    title="Remove"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Shared with me section — only show when there are shared items.
            Hidden for partner-tier AND client users: their shared client folders /
            spaces / lists are surfaced as roots under AREAS (SpaceTree →
            PartnerSharedRoots). */}
        {!isPartner && !isClient && sharedItems && sharedItems.length > 0 && (
          <>
            {/* Divider */}
            <div className="mx-2 border-t border-[var(--sh-hair)]" />

            <div className="pb-1">
              <SectionHeader
                title="Shared with me"
                expanded={expandedSections.sharedWithMe}
                onToggle={() => toggleSection('sharedWithMe')}
              />
              {expandedSections.sharedWithMe && (
                <div className="px-2 pb-1">
                  {sharedLoading && (
                    <p className="px-2 py-[5px] text-[11.5px] text-[var(--sh-ink-4)]">Loading...</p>
                  )}
                  {sharedItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={(e) => {
                        if (item.resource_type !== 'list') return;
                        if (wantsNewTab(e)) {
                          e.preventDefault();
                          useTabsStore.getState().openInNewTab(buildListSnapshot(item.space_id, item.resource_id), { background: e.button === 1 });
                          return;
                        }
                        setActiveSpace(item.space_id);
                        setActiveList(item.resource_id);
                        // Explicitly switch to the tasks view (like Favorites
                        // does). Relying on MainLayout's activeListId-change
                        // effect silently fails when the clicked list is
                        // already the active one, so nothing opens until a
                        // page refresh re-runs that effect on mount.
                        onChangeView('tasks');
                      }}
                      onAuxClick={(e) => { if (e.button === 1 && item.resource_type === 'list') { e.preventDefault(); useTabsStore.getState().openInNewTab(buildListSnapshot(item.space_id, item.resource_id), { background: true }); } }}
                      className="flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] text-[var(--sh-ink-2)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                    >
                      <FavoriteIcon type={item.resource_type} />
                      <span className="truncate">{item.resource_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Divider */}
        <div className="mx-2 border-t border-[var(--sh-hair)]" />

        {/* Areas section — shown for all user types. Clients & partners have no
            owned areas, so SpaceTree surfaces their shared roots here instead of
            in a separate "Shared with me" section. */}
        {(
          <>
            <div className="pb-1">
              <SectionHeader
                title="Areas"
                expanded={expandedSections.spaces}
                onToggle={() => toggleSection('spaces')}
                action={
                  canCreateSpaces ? (
                    <button
                      onClick={() => setShowCreateSpace(true)}
                      className="text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
                      title="Create area"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  ) : undefined
                }
              />
              {expandedSections.spaces && (
                <div className="pb-1">
                  <SpaceTree workspaceId={workspaceId} onRequestCreate={() => setShowCreateSpace(true)} />
                </div>
              )}
              {showCreateSpace && (
                <CreateSpaceModal workspaceId={workspaceId} onClose={() => setShowCreateSpace(false)} />
              )}
            </div>

            {/* Divider */}
            <div className="mx-2 border-t border-[var(--sh-hair)]" />
          </>
        )}

        {/* Channels section */}
        <div className="pb-1">
          <SectionHeader
            title="Channels"
            expanded={expandedSections.channels}
            onToggle={() => toggleSection('channels')}
            action={
              canCreateChannels ? (
                <button
                  onClick={onCreateChannel}
                  className="text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
                  title="Create channel"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              ) : undefined
            }
          />
          {expandedSections.channels && (
            <div className="px-2 pb-1">
              {channels.length === 0 ? (
                <p className="px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">No channels yet</p>
              ) : (
                channels.map((ch) => {
                  const isActive = activeChannelId === ch.id && homeView === 'chat';
                  return (
                    <button
                      key={ch.id}
                      onClick={() => onSelectChannel(ch.id)}
                      className={`mb-[1px] flex w-full items-center rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
                        isActive
                          ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                          : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
                      }`}
                      style={isActive ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
                    >
                      <span className={`mr-[6px] ${isActive ? 'text-[var(--sh-ink-3)]' : 'text-[var(--sh-ink-4)]'}`}>#</span>
                      <span className="truncate">{ch.name}</span>
                    </button>
                  );
                })
              )}
              {/* Add channels */}
              <button
                onClick={onCreateChannel}
                className="flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] text-[var(--sh-ink-4)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add channels
              </button>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="mx-2 border-t border-[var(--sh-hair)]" />

        {/* DMs section */}
        <div className="pb-1">
          <SectionHeader
            title="Direct Messages"
            expanded={expandedSections.dms}
            onToggle={() => toggleSection('dms')}
            action={
              canSendDms ? (
                <button
                  onClick={() => setShowNewDm(true)}
                  className="text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
                  title="New direct message"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              ) : undefined
            }
          />
          {expandedSections.dms && (
            <div className="px-2 pb-1">
              {dms.length === 0 ? (
                <p className="px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">No direct messages yet</p>
              ) : (
                dms.map((dm) => (
                  <DmListItem
                    key={dm.id}
                    dm={dm}
                    active={activeChannelId === dm.id && activeChannelKind === 'dm' && homeView === 'chat'}
                    onClick={() => onSelectDm(dm.id)}
                  />
                ))
              )}
              {canSendDms && (
                <button
                  onClick={() => setShowNewDm(true)}
                  className="flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] text-[var(--sh-ink-4)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New direct message
                </button>
              )}
            </div>
          )}
        </div>

        {showNewDm && (
          <NewDmModal workspaceId={workspaceId} onClose={() => setShowNewDm(false)} />
        )}

        {/* CRM Chats — open team discussions linked to CRM deals / contacts / leads */}
        <div className="mx-2 border-t border-[var(--sh-hair)]" />
        <div className="pb-1">
          <SectionHeader
            title="CRM Chats"
            expanded={expandedSections.crmChats}
            onToggle={() => toggleSection('crmChats')}
          />
          {expandedSections.crmChats && (
            <div className="px-2 pb-1">
              {crmChats.length === 0 ? (
                <p className="px-2 py-2 text-[11.5px] leading-snug text-[var(--sh-ink-4)]">
                  No open CRM chats. Open a deal or contact in CRM and start a team chat.
                </p>
              ) : (
                crmChats.map((ch) => {
                  const isActive = activePanelChannelId === ch.channel_id;
                  return (
                    <div
                      key={ch.channel_id}
                      className={`mb-[1px] group flex w-full items-center rounded-[6px] transition ${
                        isActive
                          ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                          : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
                      }`}
                      style={isActive ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          openChatPanel({
                            channelId: ch.channel_id,
                            containerLabel: ch.subtitle
                              ? `${ch.label} · ${ch.subtitle}`
                              : ch.label,
                            isCrmChat: true,
                          })
                        }
                        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-[5px] text-left text-[13px]"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            ch.entity_type === 'crm_deal'
                              ? 'bg-indigo-500'
                              : ch.entity_type === 'crm_contact'
                                ? 'bg-sky-500'
                                : 'bg-emerald-600'
                          }`}
                        />
                        <span className="truncate">{ch.label}</span>
                      </button>
                      <button
                        type="button"
                        title="Close chat"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeCrmChat.mutate(ch.channel_id);
                        }}
                        className="mr-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded text-[var(--sh-ink-4)] opacity-0 transition hover:bg-[var(--sh-hair)] hover:text-[var(--sh-ink)] group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function PartnerOpportunitiesLink({
  active, onClick,
}: { active: boolean; onClick: () => void }) {
  const { data } = useQuery({
    queryKey: ['partner-opportunities-pending'],
    queryFn: () => api.get('/partner/opportunities?status=pending').then((r) => r.data),
    refetchInterval: 30_000,
  });
  const pending: SubscriptionCardRecipient[] = data?.data || [];
  const pendingCount = pending.length;

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
        active
          ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
          : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
      }`}
      style={active ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
    >
      <svg
        className={`h-[14px] w-[14px] shrink-0 ${active ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
      </svg>
      <span className="flex-1">Opportunities</span>
      {pendingCount > 0 && (
        <span className="grid min-w-[18px] place-items-center rounded-full bg-[var(--sh-ink)] px-1.5 text-[10px] font-semibold text-[var(--sidebar)]">
          {pendingCount}
        </span>
      )}
    </button>
  );
}
