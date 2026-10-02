import { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Channel, DmConversation, SubscriptionCardRecipient } from '@squadhub/shared';
import type { HomeView } from '../../layouts/MainLayout';
import api from '../../services/api';
import { useFavorites, useRemoveFavorite } from '../../hooks/useFavorites';
import { useSharedWithMe } from '../../hooks/useSharedWithMe';
import { useWorkspaces } from '../../hooks/useSpaces';
import { useHasPermission } from '../../hooks/usePermissions';
import { usePMStore, DEFAULT_SIDEBAR_SECTION_ORDER } from '../../stores/pmStore';
import { useTabsStore } from '../../stores/tabsStore';
import { wantsNewTab, buildListSnapshot, buildFolderSnapshot, buildSpaceSnapshot, buildChatSnapshot, buildAppSnapshot } from '../../lib/tabSnapshots';
import { useCardsAttention } from '@/views/admin/useCardsAttention';
import SpaceTree, { WorkspaceTree } from './pm/SpaceTree';
import CreateSpaceModal from './pm/CreateSpaceModal';
import CreateFolderListModal from './pm/CreateFolderListModal';
import { useAvailableApps } from '../../hooks/useApps';
import { useAppFavorites, useMigrateLocalAppFavorites } from '../../hooks/useAppFavorites';
import { AppIcon, type AppDef } from '../../config/apps';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { useUnreadSummary } from '../../hooks/useUnreadSummary';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useIsClient, useIsPartner } from '../../hooks/useUserType';
import { useDms } from '../../hooks/useDms';
import NewDmModal from './chat/NewDmModal';
import DmListItem from './chat/DmListItem';
import UnreadBadge from '../../components/UnreadBadge';
import { useCloseCrmChat, useCrmChats } from '../../hooks/useCrmChats';
import TeamChatAppBadge from './teamchat/TeamChatAppBadge';
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
  /** Collapse the module sidebar (owned by MainLayout). */
  onCloseSidebar?: () => void;
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
      data-active={active || undefined}
      className={`sb-nav flex w-full items-center gap-[10px] rounded-[11px] px-[10px] py-[7px] text-left text-[13px] transition ${
        active
          ? 'bg-[var(--sh-ink)] text-[var(--sidebar)] font-semibold'
          : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
      }`}
    >
      <span className={active ? 'text-[var(--sidebar)]' : 'text-[var(--sh-ink-3)]'}>{icon}</span>
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
            className={`relative text-[10.5px] font-bold rounded-full px-[6px] py-[2px] leading-none ${
              alert
                ? 'text-white'
                : active
                  ? 'bg-white/20 text-[var(--sidebar)]'
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

function DragGripIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

// ---- Collapsible section header (monochrome eyebrow) ----
function SectionHeader({
  title,
  expanded,
  onToggle,
  action,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isOverBefore,
  isOverAfter,
  isDragging,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isOverBefore?: boolean;
  isOverAfter?: boolean;
  isDragging?: boolean;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`group flex items-center justify-between px-2 pt-4 pb-1 transition-all select-none rounded-[6px] ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
      style={{
        opacity: isDragging ? 0.35 : 1,
        boxShadow: isOverBefore
          ? 'inset 0 2px 0 var(--sh-ink)'
          : isOverAfter
            ? 'inset 0 -2px 0 var(--sh-ink)'
            : undefined,
      }}
    >
      <div className="flex items-center gap-1 min-w-0">
        <button
          onClick={onToggle}
          className="flex items-center justify-center h-4 w-4 text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)] transition-colors shrink-0"
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
          className="sb-section text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)] whitespace-nowrap transition-colors truncate"
        >
          {title}
        </button>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {action && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">
            {action}
          </span>
        )}
        {draggable && (
          <span
            className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity text-[var(--sh-ink-4)] cursor-grab"
            title="Drag section to reorder"
          >
            <DragGripIcon className="h-3 w-3" />
          </span>
        )}
      </div>
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
  onCloseSidebar,
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
  const canCreateFolders = useHasPermission('can_create_folders');
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const isClient = useIsClient();
  const isPartner = useIsPartner();
  // Apps the user can access + their pinned subset (shown in the Apps section).
  const availableApps = useAvailableApps();
  // One-time backfill of any pins saved client-side before server sync existed.
  useMigrateLocalAppFavorites(true);
  const { data: appFavorites = [] } = useAppFavorites();
  const favoriteApps = availableApps.filter((a) => appFavorites.includes(a.slug));
  // Requirement Cards is the one pinned app with a queue behind it — its row
  // carries how much of the pipeline is waiting on us. Skipped entirely when
  // it isn't pinned, so nobody pays for a badge they can't see.
  const cardsPinned = favoriteApps.some((a) => a.slug === 'leads');
  const cardsAttention = useCardsAttention(cardsPinned);
  const { data: inboxUnreadCount } = useUnreadCount();
  const { data: unreadSummary } = useUnreadSummary();

  // Channels shown in the sidebar (support has its own rail entry) — reused by
  // the Channels section and the Unread section below.
  const visibleChannels = channels.filter((c) => c.channel_kind !== 'support');

  // Conversations with unread messages, most-unread first. Empty while the
  // summary hasn't loaded, which keeps the Unread section hidden until then.
  const unreadEntries: Array<
    | { kind: 'channel'; channel: Channel; count: number }
    | { kind: 'dm'; dm: DmConversation; count: number }
  > = [];
  for (const ch of visibleChannels) {
    const count = unreadSummary?.channels[ch.id] ?? 0;
    if (count > 0) unreadEntries.push({ kind: 'channel', channel: ch, count });
  }
  for (const dm of dms) {
    const count = unreadSummary?.dms[dm.id] ?? 0;
    if (count > 0) unreadEntries.push({ kind: 'dm', dm, count });
  }
  unreadEntries.sort((a, b) => b.count - a.count);

  const { data: workspaces } = useWorkspaces(isClient || isPartner ? undefined : workspaceId);

  const sidebarSectionsExpanded = usePMStore((s) => s.sidebarSectionsExpanded);
  const toggleSidebarSection = usePMStore((s) => s.toggleSidebarSection);
  const favoriteItemsOrder = usePMStore((s) => s.favoriteItemsOrder);
  const setFavoriteItemsOrder = usePMStore((s) => s.setFavoriteItemsOrder);
  const appFavoritesOrder = usePMStore((s) => s.appFavoritesOrder);
  const setAppFavoritesOrder = usePMStore((s) => s.setAppFavoritesOrder);
  const sidebarSectionOrder = usePMStore((s) => s.sidebarSectionOrder);
  const setSidebarSectionOrder = usePMStore((s) => s.setSidebarSectionOrder);

  const isSectionExpanded = (key: string) => sidebarSectionsExpanded[key] ?? true;
  const toggleSection = (key: string) => {
    toggleSidebarSection(key);
  };

  // Sorted favorite apps based on appFavoritesOrder
  const sortedFavoriteApps = useMemo(() => {
    if (!favoriteApps.length) return [];
    if (!appFavoritesOrder || appFavoritesOrder.length === 0) return favoriteApps;
    const orderMap = new Map(appFavoritesOrder.map((slug, idx) => [slug, idx]));
    return [...favoriteApps].sort((a, b) => {
      const idxA = orderMap.has(a.slug) ? orderMap.get(a.slug)! : 999999;
      const idxB = orderMap.has(b.slug) ? orderMap.get(b.slug)! : 999999;
      if (idxA !== idxB) return idxA - idxB;
      return a.name.localeCompare(b.name);
    });
  }, [favoriteApps, appFavoritesOrder]);

  // Sorted favorites based on favoriteItemsOrder
  const sortedFavorites = useMemo(() => {
    if (!favorites || favorites.length === 0) return [];
    if (!favoriteItemsOrder || favoriteItemsOrder.length === 0) return favorites;
    const orderMap = new Map(favoriteItemsOrder.map((id, idx) => [id, idx]));
    return [...favorites].sort((a, b) => {
      const idxA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999999;
      const idxB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999999;
      if (idxA !== idxB) return idxA - idxB;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }, [favorites, favoriteItemsOrder]);

  // DnD state for favorites
  const [dragFavId, setDragFavId] = useState<string | null>(null);
  const [overFav, setOverFav] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);

  const handleFavDragStart = (id: string) => {
    setDragFavId(id);
  };

  const handleFavDragOver = (e: React.DragEvent, id: string) => {
    if (!dragFavId || dragFavId === id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setOverFav((prev) => (prev && prev.id === id && prev.pos === pos ? prev : { id, pos }));
  };

  const handleFavDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragFavId || dragFavId === targetId) {
      setDragFavId(null);
      setOverFav(null);
      return;
    }
    const currentIds = sortedFavorites.map((f) => f.id);
    const from = currentIds.indexOf(dragFavId);
    let to = currentIds.indexOf(targetId) + (overFav?.pos === 'before' ? 0 : 1);
    if (from < to) to -= 1;
    if (from !== -1 && to !== -1 && from !== to) {
      const newIds = [...currentIds];
      newIds.splice(from, 1);
      newIds.splice(to, 0, dragFavId);
      setFavoriteItemsOrder(newIds);
    }
    setDragFavId(null);
    setOverFav(null);
  };

  const handleFavDragEnd = () => {
    setDragFavId(null);
    setOverFav(null);
  };

  // DnD state for apps in Apps section
  const [dragAppSlug, setDragAppSlug] = useState<string | null>(null);
  const [overApp, setOverApp] = useState<{ slug: string; pos: 'before' | 'after' } | null>(null);

  const handleAppDragStart = (slug: string) => {
    setDragAppSlug(slug);
  };

  const handleAppDragOver = (e: React.DragEvent, slug: string) => {
    if (!dragAppSlug || dragAppSlug === slug) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setOverApp((prev) => (prev && prev.slug === slug && prev.pos === pos ? prev : { slug, pos }));
  };

  const handleAppDrop = (e: React.DragEvent, targetSlug: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragAppSlug || dragAppSlug === targetSlug) {
      setDragAppSlug(null);
      setOverApp(null);
      return;
    }
    const currentSlugs = sortedFavoriteApps.map((a) => a.slug);
    const from = currentSlugs.indexOf(dragAppSlug);
    let to = currentSlugs.indexOf(targetSlug) + (overApp?.pos === 'before' ? 0 : 1);
    if (from < to) to -= 1;
    if (from !== -1 && to !== -1 && from !== to) {
      const newSlugs = [...currentSlugs];
      newSlugs.splice(from, 1);
      newSlugs.splice(to, 0, dragAppSlug);
      setAppFavoritesOrder(newSlugs);
    }
    setDragAppSlug(null);
    setOverApp(null);
  };

  const handleAppDragEnd = () => {
    setDragAppSlug(null);
    setOverApp(null);
  };

  // DnD state for sidebar sections
  const [dragSectionKey, setDragSectionKey] = useState<string | null>(null);
  const [overSection, setOverSection] = useState<{ key: string; pos: 'before' | 'after' } | null>(null);

  const handleSectionDragStart = (key: string) => {
    setDragSectionKey(key);
  };

  const handleSectionDragOver = (e: React.DragEvent, key: string) => {
    if (!dragSectionKey || dragSectionKey === key) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setOverSection((prev) => (prev && prev.key === key && prev.pos === pos ? prev : { key, pos }));
  };

  const handleSectionDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragSectionKey || dragSectionKey === targetKey) {
      setDragSectionKey(null);
      setOverSection(null);
      return;
    }
    const allSections = DEFAULT_SIDEBAR_SECTION_ORDER;
    const currentOrder = [
      ...sidebarSectionOrder.filter((k) => allSections.includes(k)),
      ...allSections.filter((k) => !sidebarSectionOrder.includes(k)),
    ];
    const from = currentOrder.indexOf(dragSectionKey);
    let to = currentOrder.indexOf(targetKey) + (overSection?.pos === 'before' ? 0 : 1);
    if (from < to) to -= 1;
    if (from !== -1 && to !== -1 && from !== to) {
      const newOrder = [...currentOrder];
      newOrder.splice(from, 1);
      newOrder.splice(to, 0, dragSectionKey);
      setSidebarSectionOrder(newOrder);
    }
    setDragSectionKey(null);
    setOverSection(null);
  };

  const handleSectionDragEnd = () => {
    setDragSectionKey(null);
    setOverSection(null);
  };

  const sectionHeaderDndProps = (key: string) => ({
    draggable: true,
    isDragging: dragSectionKey === key,
    isOverBefore: overSection?.key === key && overSection.pos === 'before',
    isOverAfter: overSection?.key === key && overSection.pos === 'after',
    onDragStart: () => handleSectionDragStart(key),
    onDragOver: (e: React.DragEvent) => handleSectionDragOver(e, key),
    onDrop: (e: React.DragEvent) => handleSectionDrop(e, key),
    onDragEnd: handleSectionDragEnd,
  });

  const orderedSectionKeys = useMemo(() => {
    const all = DEFAULT_SIDEBAR_SECTION_ORDER;
    return [
      ...sidebarSectionOrder.filter((k) => all.includes(k)),
      ...all.filter((k) => !sidebarSectionOrder.includes(k)),
    ];
  }, [sidebarSectionOrder]);

  const { data: crmChats = [] } = useCrmChats(workspaceId);
  const closeCrmChat = useCloseCrmChat(workspaceId);
  const openChatPanel = useChatSidePanelStore((s) => s.open);
  const activePanelChannelId = useChatSidePanelStore((s) => (s.isOpen ? s.channelId : null));

  return (
    <div className="group/sidebar flex h-full w-full flex-col text-[var(--sh-ink-2)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        {/* Brand lockup — "SquadHub" with a "Powered by UpSquad" subtitle,
            matching the squadhire/login lockup style. */}
        <div className="flex items-center gap-[10px]">
          <span className="sb-brand" aria-hidden="true" />
          <div className="flex flex-col leading-tight">
            <span className="sb-wordmark text-[var(--sh-ink)]">SquadHub</span>
            <span className="sb-tagline text-[var(--sh-ink-4)]">Powered by UpSquad</span>
          </div>
        </div>
        <div className="flex items-center gap-[2px]">
          {/* Back/forward — visible only on sidebar hover */}
          <span className="flex items-center gap-[2px] opacity-0 transition-opacity duration-150 group-hover/sidebar:opacity-100 focus-within:opacity-100">
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
          </span>
          {onCloseSidebar && (
            <button
              onClick={onCloseSidebar}
              className="grid h-[26px] w-[26px] place-items-center rounded-[6px] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] transition"
              title="Close sidebar"
              aria-label="Close sidebar"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="m11 7-5 5 5 5" />
                <path d="m18 7-5 5 5 5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Search — a grey pill that opens the workspace palette */}
      <div className="px-3 pt-1 pb-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-[36px] w-full items-center gap-[9px] rounded-full bg-[var(--sh-hair-3)] pl-[13px] pr-[6px] text-left text-[12.5px] font-medium text-[var(--sh-ink-4)] transition hover:bg-[var(--sh-hair)] hover:text-[var(--sh-ink-3)]"
          title="Search (⌘K)"
          aria-label="Open workspace search"
        >
          <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <span className="flex-1 truncate">Search or jump to…</span>
          <span
            className="grid h-[22px] min-w-[26px] place-items-center rounded-full bg-[var(--sidebar)] px-[6px] text-[10px] font-semibold text-[var(--sh-ink-3)] shadow-[inset_1px_1px_1px_0_rgba(255,255,255,.9)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]"
          >⌘K</span>
        </button>
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
          {/* Goals — outcomes tracked through linked tasks (sits right below My Tasks). */}
          <NavItem
            icon={
              <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M5.5 21V3.5" />
                <path d="M5.5 4.5c4.5-2.6 8 2.6 13 0v8.5c-5 2.6-8.5-2.6-13 0" />
              </svg>
            }
            label="Goals"
            active={homeView === 'goals'}
            onClick={() => onChangeView('goals')}
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

        {/* Dynamic reorderable sections */}
        {orderedSectionKeys.map((secKey) => {
          switch (secKey) {
            case 'unread':
              if (unreadEntries.length === 0) return null;
              return (
                <div key="unread">
                  <div className="py-1">
                    <SectionHeader
                      title="Unread"
                      expanded={isSectionExpanded('unread')}
                      onToggle={() => toggleSection('unread')}
                      {...sectionHeaderDndProps('unread')}
                    />
                    {isSectionExpanded('unread') && (
                      <div className="px-2 pb-1">
                        {unreadEntries.map((entry) =>
                          entry.kind === 'channel' ? (
                            <button
                              key={`channel-${entry.channel.id}`}
                              onClick={() => onSelectChannel(entry.channel.id)}
                              className="mb-[1px] flex w-full items-center rounded-[10px] px-[10px] py-[6px] text-left text-[13px] text-[var(--sh-ink-2)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                            >
                              <span className="mr-[6px] text-[var(--sh-ink-4)]">#</span>
                              <span className="flex-1 truncate">{entry.channel.name}</span>
                              <UnreadBadge count={entry.count} />
                            </button>
                          ) : (
                            <DmListItem
                              key={`dm-${entry.dm.id}`}
                              dm={entry.dm}
                              active={
                                activeChannelId === entry.dm.id &&
                                activeChannelKind === 'dm' &&
                                homeView === 'chat'
                              }
                              unreadCount={entry.count}
                              onClick={() => onSelectDm(entry.dm.id)}
                            />
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mx-2 border-t border-[var(--sh-hair)]" />
                </div>
              );

            case 'apps':
              if (availableApps.length === 0) return null;
              return (
                <div key="apps">
                  <div className="py-1" data-tip-anchor="home.apps">
                    <SectionHeader
                      title="Apps"
                      expanded={isSectionExpanded('apps')}
                      onToggle={() => toggleSection('apps')}
                      {...sectionHeaderDndProps('apps')}
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
                    {isSectionExpanded('apps') && (
                      <div className="px-2 pb-1">
                        {favoriteApps.length === 0 ? (
                          <button
                            onClick={onOpenApps}
                            className="w-full px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink-3)]"
                          >
                            Star apps to pin them here
                          </button>
                        ) : (
                          sortedFavoriteApps.map((app) => {
                            const active = !!app.view && homeView === app.view;
                            const isDragging = dragAppSlug === app.slug;
                            const isOverBefore = overApp?.slug === app.slug && overApp.pos === 'before';
                            const isOverAfter = overApp?.slug === app.slug && overApp.pos === 'after';

                            return (
                              <div
                                key={app.slug}
                                draggable
                                onDragStart={() => handleAppDragStart(app.slug)}
                                onDragOver={(e) => handleAppDragOver(e, app.slug)}
                                onDrop={(e) => handleAppDrop(e, app.slug)}
                                onDragEnd={handleAppDragEnd}
                                className={`group mb-[1px] flex w-full items-center rounded-[10px] transition cursor-grab active:cursor-grabbing ${
                                  active
                                    ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                                    : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
                                }`}
                                style={{
                                  opacity: isDragging ? 0.35 : 1,
                                  boxShadow: isOverBefore
                                    ? 'inset 0 2px 0 var(--sh-ink)'
                                    : isOverAfter
                                      ? 'inset 0 -2px 0 var(--sh-ink)'
                                      : active
                                        ? 'var(--sh-shadow-sm)'
                                        : undefined,
                                }}
                              >
                                <button
                                  onClick={(e) => {
                                    if (app.view && wantsNewTab(e)) {
                                      e.preventDefault();
                                      useTabsStore.getState().openInNewTab(buildAppSnapshot(app.view, 'home'), { background: e.button === 1 });
                                      return;
                                    }
                                    onLaunchApp(app);
                                  }}
                                  onAuxClick={(e) => { if (e.button === 1 && app.view) { e.preventDefault(); useTabsStore.getState().openInNewTab(buildAppSnapshot(app.view, 'home'), { background: true }); } }}
                                  className="flex min-w-0 flex-1 items-center gap-[9px] px-[10px] py-[6px] text-left text-[13px]"
                                >
                                  <AppIcon
                                    paths={app.paths}
                                    className={`h-[14px] w-[14px] shrink-0 ${active ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`}
                                  />
                                  <span className="flex-1 truncate">{app.name}</span>
                                  {app.slug === 'squadcrm-teamchat' && <TeamChatAppBadge source="crm" />}
                                  {app.slug === 'squadhire-teamchat' && <TeamChatAppBadge source="shcrm" />}
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
                                <span
                                  className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity mr-2 text-[var(--sh-ink-4)] cursor-grab shrink-0"
                                  title="Drag to reorder"
                                >
                                  <DragGripIcon className="h-3 w-3" />
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mx-2 border-t border-[var(--sh-hair)]" />
                </div>
              );

            case 'favorites':
              return (
                <div key="favorites">
                  <div className="py-1">
                    <SectionHeader
                      title="Favorites"
                      expanded={isSectionExpanded('favorites')}
                      onToggle={() => toggleSection('favorites')}
                      {...sectionHeaderDndProps('favorites')}
                    />
                    {isSectionExpanded('favorites') && (
                      <div className="px-2 pb-1">
                        {favoritesLoading && (
                          <p className="px-2 py-[5px] text-[11.5px] text-[var(--sh-ink-4)]">Loading...</p>
                        )}
                        {!favoritesLoading && (!sortedFavorites || sortedFavorites.length === 0) && (
                          <p className="px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">
                            Star items to pin them here
                          </p>
                        )}
                        {sortedFavorites?.map((fav) => {
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
                            <div
                              key={fav.id}
                              draggable
                              onDragStart={() => handleFavDragStart(fav.id)}
                              onDragOver={(e) => handleFavDragOver(e, fav.id)}
                              onDrop={(e) => handleFavDrop(e, fav.id)}
                              onDragEnd={handleFavDragEnd}
                              className="group mb-[1px] flex items-center rounded-[10px] transition cursor-grab active:cursor-grabbing"
                              style={{
                                opacity: dragFavId === fav.id ? 0.35 : 1,
                                boxShadow:
                                  overFav?.id === fav.id
                                    ? overFav.pos === 'before'
                                      ? 'inset 0 2px 0 var(--sh-ink)'
                                      : 'inset 0 -2px 0 var(--sh-ink)'
                                    : undefined,
                              }}
                            >
                              <button
                                onClick={openFav}
                                onAuxClick={(e) => { if (e.button === 1) openFav(e); }}
                                className="flex min-w-0 flex-1 items-center gap-[9px] rounded-[10px] px-[10px] py-[6px] text-left text-[13px] text-[var(--sh-ink-2)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                              >
                                <FavoriteIcon type={fav.item_type} />
                                <span className="truncate">{fav.item_name}</span>
                              </button>
                              <span
                                className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity mr-1 text-[var(--sh-ink-4)] cursor-grab shrink-0"
                                title="Drag to reorder"
                              >
                                <DragGripIcon className="h-3 w-3" />
                              </span>
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
                  <div className="mx-2 border-t border-[var(--sh-hair)]" />
                </div>
              );

            case 'sharedWithMe':
              if (isPartner || isClient || !sharedItems || sharedItems.length === 0) return null;
              return (
                <div key="sharedWithMe">
                  <div className="pb-1">
                    <SectionHeader
                      title="Shared with me"
                      expanded={isSectionExpanded('sharedWithMe')}
                      onToggle={() => toggleSection('sharedWithMe')}
                      {...sectionHeaderDndProps('sharedWithMe')}
                    />
                    {isSectionExpanded('sharedWithMe') && (
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
                              onChangeView('tasks');
                            }}
                            onAuxClick={(e) => { if (e.button === 1 && item.resource_type === 'list') { e.preventDefault(); useTabsStore.getState().openInNewTab(buildListSnapshot(item.space_id, item.resource_id), { background: true }); } }}
                            className="flex w-full items-center gap-[9px] rounded-[10px] px-[10px] py-[6px] text-left text-[13px] text-[var(--sh-ink-2)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                          >
                            <FavoriteIcon type={item.resource_type} />
                            <span className="truncate">{item.resource_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mx-2 border-t border-[var(--sh-hair)]" />
                </div>
              );

            case 'workspaces':
              if (isPartner || isClient) return null;
              return (
                <div key="workspaces">
                  <div className="pb-1">
                    <SectionHeader
                      title="Workspaces"
                      expanded={isSectionExpanded('workspaces')}
                      onToggle={() => toggleSection('workspaces')}
                      {...sectionHeaderDndProps('workspaces')}
                      action={
                        canCreateFolders && workspaces?.length ? (
                          <button
                            onClick={() => setShowCreateWorkspace(true)}
                            className="text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
                            title="Create workspace"
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        ) : undefined
                      }
                    />
                    {isSectionExpanded('workspaces') && (
                      <div className="pb-1">
                        <WorkspaceTree workspaceId={workspaceId} />
                      </div>
                    )}
                    {showCreateWorkspace && workspaces?.[0] && (
                      <CreateFolderListModal
                        type="client"
                        spaceId={workspaces[0].id}
                        onClose={() => setShowCreateWorkspace(false)}
                      />
                    )}
                  </div>
                  <div className="mx-2 border-t border-[var(--sh-hair)]" />
                </div>
              );

            case 'spaces':
              return (
                <div key="spaces">
                  <div className="pb-1">
                    <SectionHeader
                      title="Areas"
                      expanded={isSectionExpanded('spaces')}
                      onToggle={() => toggleSection('spaces')}
                      {...sectionHeaderDndProps('spaces')}
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
                    {isSectionExpanded('spaces') && (
                      <div className="pb-1">
                        <SpaceTree workspaceId={workspaceId} onRequestCreate={() => setShowCreateSpace(true)} />
                      </div>
                    )}
                    {showCreateSpace && (
                      <CreateSpaceModal workspaceId={workspaceId} onClose={() => setShowCreateSpace(false)} />
                    )}
                  </div>
                  <div className="mx-2 border-t border-[var(--sh-hair)]" />
                </div>
              );

            case 'channels':
              return (
                <div key="channels">
                  <div className="pb-1">
                    <SectionHeader
                      title="Channels"
                      expanded={isSectionExpanded('channels')}
                      onToggle={() => toggleSection('channels')}
                      {...sectionHeaderDndProps('channels')}
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
                    {isSectionExpanded('channels') && (
                      <div className="px-2 pb-1">
                        {visibleChannels.length === 0 ? (
                          <p className="px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">No channels yet</p>
                        ) : (
                          visibleChannels.map((ch) => {
                            const isActive = activeChannelId === ch.id && homeView === 'chat';
                            const unreadCount = unreadSummary?.channels[ch.id] ?? 0;
                            return (
                              <button
                                key={ch.id}
                                onClick={() => onSelectChannel(ch.id)}
                                className={`mb-[1px] flex w-full items-center rounded-[10px] px-[10px] py-[6px] text-left text-[13px] transition ${
                                  isActive
                                    ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                                    : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
                                }`}
                                style={isActive ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
                              >
                                <span className={`mr-[6px] ${isActive ? 'text-[var(--sh-ink-3)]' : 'text-[var(--sh-ink-4)]'}`}>#</span>
                                <span className="flex-1 truncate">{ch.name}</span>
                                <UnreadBadge count={unreadCount} />
                              </button>
                            );
                          })
                        )}
                        {/* Add channels */}
                        <button
                          onClick={onCreateChannel}
                          className="flex w-full items-center gap-[9px] rounded-[10px] px-[10px] py-[6px] text-left text-[13px] text-[var(--sh-ink-4)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                        >
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add channels
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mx-2 border-t border-[var(--sh-hair)]" />
                </div>
              );

            case 'dms':
              return (
                <div key="dms">
                  <div className="pb-1">
                    <SectionHeader
                      title="Direct Messages"
                      expanded={isSectionExpanded('dms')}
                      onToggle={() => toggleSection('dms')}
                      {...sectionHeaderDndProps('dms')}
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
                    {isSectionExpanded('dms') && (
                      <div className="px-2 pb-1">
                        {dms.length === 0 ? (
                          <p className="px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">No direct messages yet</p>
                        ) : (
                          dms.map((dm) => (
                            <DmListItem
                              key={dm.id}
                              dm={dm}
                              active={activeChannelId === dm.id && activeChannelKind === 'dm' && homeView === 'chat'}
                              unreadCount={unreadSummary?.dms[dm.id] ?? 0}
                              onClick={() => onSelectDm(dm.id)}
                            />
                          ))
                        )}
                        {canSendDms && (
                          <button
                            onClick={() => setShowNewDm(true)}
                            className="flex w-full items-center gap-[9px] rounded-[10px] px-[10px] py-[6px] text-left text-[13px] text-[var(--sh-ink-4)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
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
                  <div className="mx-2 border-t border-[var(--sh-hair)]" />
                </div>
              );

            case 'crmChats':
              return (
                <div key="crmChats">
                  <div className="pb-1">
                    <SectionHeader
                      title="CRM Chats"
                      expanded={isSectionExpanded('crmChats')}
                      onToggle={() => toggleSection('crmChats')}
                      {...sectionHeaderDndProps('crmChats')}
                    />
                    {isSectionExpanded('crmChats') && (
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
                                      crmEntityType: ch.entity_type,
                                      crmEntityId: ch.entity_id,
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
                  <div className="mx-2 border-t border-[var(--sh-hair)]" />
                </div>
              );

            default:
              return null;
          }
        })}
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
      className={`flex w-full items-center gap-[9px] rounded-[10px] px-[10px] py-[6px] text-left text-[13px] transition ${
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
