import { useEffect, useState, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Channel, DmConversation, Favorite, Folder, List, Space, SubscriptionCardRecipient } from '@squadhub/shared';
import type { HomeView } from '../../layouts/MainLayout';
import api from '../../services/api';
import { useFavorites, useRemoveFavorite } from '../../hooks/useFavorites';
import { useSharedWithMe } from '../../hooks/useSharedWithMe';
import { useSpaces, useWorkspaces } from '../../hooks/useSpaces';
import { useHasPermission } from '../../hooks/usePermissions';
import { usePMStore } from '../../stores/pmStore';
import { useTabsStore } from '../../stores/tabsStore';
import { useAuthStore } from '../../stores/authStore';
import { useRecentOpensStore } from '../../stores/recentOpensStore';
import { wantsNewTab, buildListSnapshot, buildFolderSnapshot, buildSpaceSnapshot, buildChatSnapshot, buildAppSnapshot } from '../../lib/tabSnapshots';
import { useCardsAttention } from '@/views/admin/useCardsAttention';
import SpaceTree, { WorkspaceTree } from './pm/SpaceTree';
import TreeCollapse from '../../components/TreeCollapse';
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

// Apps and favorites opened within this many days show up front; the rest
// fold under "More".
const RECENT_DAYS = 7;
const DAY_MS = 86_400_000;
const TAB_KEY = 'squadhub-sidebar-tab';
const APPS_COLLAPSED_KEY = 'squadhub-sidebar-apps-collapsed';

// ---- Icon paths (24×24 outline, stroke 2) ----
const ICON = {
  home: 'M4 10.2a2 2 0 0 1 .75-1.56l6-4.8a2 2 0 0 1 2.5 0l6 4.8A2 2 0 0 1 20 10.2V17a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z M10 16h4',
  inbox: 'M4 8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z M4 13h3.5l1.5 2h6l1.5-2H20',
  day: 'M4.5 13a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0-15 0 M12 9.5V13l2.5 1.5 M5 3.5 3.5 5 M19 3.5 20.5 5',
  routines: 'M16.5 3l3 3-3 3 M4.5 12v-1a5 5 0 0 1 5-5h10 M7.5 21l-3-3 3-3 M19.5 12v1a5 5 0 0 1-5 5h-10',
  tasks: 'M9 4h6a5 5 0 0 1 5 5v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5z M8.5 12.2l2.4 2.4 4.6-4.8',
  goals: 'M6 21V4.5 M6 5h11a1 1 0 0 1 .8 1.6L16 9l1.8 2.4a1 1 0 0 1-.8 1.6H6',
  opportunities: 'M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z',
  channel: 'M9.5 4l-2 16 M16.5 4l-2 16 M5 9h15 M4 15h15',
  list: 'M5 7a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z M9 8h6 M9 12h6 M9 16h3',
  folder: 'M3.5 8.5a3 3 0 0 1 3-3h3l2 2h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3z',
  space: 'M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z M4.5 7.7L12 12l7.5-4.3 M12 12v8.5',
  person: 'M8.5 8.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0 M5.5 19.5a6.5 6.5 0 0 1 13 0',
  chat: 'M4 8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-5l-4 3v-3.2A4 4 0 0 1 4 13z',
  star: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
  search: 'M4.5 11a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0 M20 20l-4-4',
  plus: 'M12 5v14m7-7H5',
};

function Icon({ d, className = 'h-[14px] w-[14px] shrink-0' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d={d} />
    </svg>
  );
}

function favoriteIconPath(type: string) {
  switch (type) {
    case 'channel': return ICON.channel;
    case 'list': return ICON.list;
    case 'folder': return ICON.folder;
    case 'space': return ICON.space;
    default: return ICON.star;
  }
}

const ageLabel = (ts: number | undefined) => {
  if (!ts) return '—';
  const d = Math.floor((Date.now() - ts) / DAY_MS);
  return d <= 0 ? 'Today' : `${d}d`;
};

// ---- Animated brand bot — idles through moods, blinks, smiles on hover ----
type Mood = 'neutral' | 'happy' | 'wink' | 'surprised';
const MOODS: Mood[] = ['neutral', 'happy', 'wink', 'surprised'];
const MOOD_LABEL: Record<Mood, string> = { neutral: 'Ready', happy: 'Happy', wink: 'Wink', surprised: 'Surprised' };
const MOOD_TRANSFORM: Record<Mood, string> = { neutral: 'none', happy: 'translateY(-1px)', wink: 'rotate(-6deg)', surprised: 'scale(1.06)' };

function BotFace() {
  const [moodIdx, setMoodIdx] = useState(0);
  const [blink, setBlink] = useState(false);
  const [hover, setHover] = useState(false);
  const hoverRef = useRef(false);
  hoverRef.current = hover;

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const moodTimer = setInterval(() => { if (!hoverRef.current) setMoodIdx((m) => (m + 1) % MOODS.length); }, 2600);
    let blinkOff: ReturnType<typeof setTimeout> | undefined;
    const blinkTimer = setInterval(() => {
      setBlink(true);
      blinkOff = setTimeout(() => setBlink(false), 140);
    }, 3700);
    return () => { clearInterval(moodTimer); clearInterval(blinkTimer); clearTimeout(blinkOff); };
  }, []);

  const mood: Mood = hover ? 'happy' : MOODS[moodIdx];
  const st = { stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round' as const, fill: 'none' };
  const openEye = (x: number) => blink
    ? <rect key={`e${x}`} x={x - 1.5} y={12.5} width={3} height={1.2} rx={0.6} fill="#fff" />
    : <rect key={`e${x}`} x={x - 1.5} y={10.5} width={3} height={5} rx={1.5} fill="#fff" />;

  let parts: React.ReactNode;
  if (mood === 'happy') {
    parts = <>
      <path d="M9 14 Q11 10.8 13 14" {...st} />
      <path d="M17 14 Q19 10.8 21 14" {...st} />
      <path d="M10.5 18 Q15 23.5 19.5 18 Z" fill="#fff" />
    </>;
  } else if (mood === 'wink') {
    parts = <>
      <path d="M9 13 Q11 15.2 13 13" {...st} />
      {openEye(19)}
      <path d="M11 19 Q15 22.5 19 19" {...st} />
    </>;
  } else if (mood === 'surprised') {
    parts = <>
      <circle cx={11} cy={13} r={blink ? 0.8 : 2.2} fill="#fff" />
      <circle cx={19} cy={13} r={blink ? 0.8 : 2.2} fill="#fff" />
      <circle cx={15} cy={20} r={1.8} {...st} strokeWidth={1.8} />
    </>;
  } else {
    parts = <>
      {openEye(11)}
      {openEye(19)}
      <path d="M11.5 19.5 Q15 21.8 18.5 19.5" {...st} />
    </>;
  }

  return (
    <span
      title={MOOD_LABEL[mood]}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="sb-brand-bot grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px]"
      style={{ transform: MOOD_TRANSFORM[mood] }}
      aria-hidden="true"
    >
      <svg width={30} height={30} viewBox="0 0 30 30">{parts}</svg>
    </span>
  );
}

// ---- Primary nav tile (3-up grid) ----
function NavTile({
  icon,
  label,
  active,
  count,
  alert = false,
  pulse = false,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  count?: number;
  /** Render the count badge red (a notification arrived recently). */
  alert?: boolean;
  /** Play the expanding pulse ring (a notification just arrived). */
  pulse?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active || undefined}
      className={`sb-tile relative flex h-14 flex-col items-center justify-center gap-[5px] rounded-[13px] text-[10.5px] font-semibold tracking-[-0.005em] ${
        active
          ? 'bg-[var(--sh-ink)] text-[var(--sidebar)] shadow-[0_6px_16px_rgba(0,0,0,.18),0_1px_2px_rgba(0,0,0,.12)] dark:shadow-[0_6px_16px_rgba(0,0,0,.45),0_1px_2px_rgba(0,0,0,.3)]'
          : 'bg-[var(--sh-hair-3)] text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair)] hover:text-[var(--sh-ink)]'
      }`}
    >
      <span className={active ? '' : 'text-[var(--sh-ink-3)]'}>
        <Icon d={icon} className="h-4 w-4" />
      </span>
      <span className="max-w-full truncate px-1">{label}</span>
      {count != null && count > 0 && (
        <span className="absolute right-2 top-[6px] grid place-items-center">
          {alert && pulse && (
            <span aria-hidden className="sh-badge-ping absolute inset-0 rounded-full" style={{ background: 'var(--sh-badge-alert)' }} />
          )}
          <span
            className={`relative rounded-full px-[5px] py-[2px] text-[10px] font-bold leading-none ${
              alert ? 'text-white' : active ? 'bg-[var(--sidebar)] text-[var(--sh-ink)]' : 'bg-[var(--sh-ink)] text-[var(--sidebar)]'
            }`}
            style={alert ? { background: 'var(--sh-badge-alert)' } : undefined}
          >
            {count > 99 ? '99+' : count}
          </span>
        </span>
      )}
    </button>
  );
}

// ---- Section label (plain eyebrow with an optional trailing action) ----
function SectionLabel({ title, action, className = 'pt-4' }: { title: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between pb-1 pl-4 pr-3 ${className}`}>
      <span className="sb-section truncate text-[var(--sh-ink-3)]">{title}</span>
      {action}
    </div>
  );
}

function HeaderIconButton({ title, onClick, d }: { title: string; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] text-[var(--sh-ink-4)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
    >
      <Icon d={d} className="h-[13px] w-[13px]" />
    </button>
  );
}

const ROW =
  'mb-[1px] flex w-full items-center gap-[9px] rounded-[10px] px-[10px] py-[6px] text-left text-[13px] transition';
const ROW_IDLE = 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]';
const ROW_ACTIVE = 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium shadow-[var(--sh-shadow-sm)] ring-1 ring-inset ring-[var(--sh-hair)]';

// ---- Sidebar search ----
interface SearchEntry {
  key: string;
  name: string;
  d: string;
  meta: string;
  open: () => void;
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
  onOpenSearch,
  onOpenApps,
  onLaunchApp,
  inboxAlert = false,
  inboxPulse = false,
  onCloseSidebar,
}: HomeSidebarProps) {
  const queryClient = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
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
  const { setActiveSpace, setActiveList, setActiveFolder, setActiveDesignFolder, setActiveSpacePage } = usePMStore();
  const canCreateChannels = useHasPermission('can_create_channels');
  const canCreateSpaces = useHasPermission('can_create_spaces');
  const canCreateFolders = useHasPermission('can_create_folders');
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const isClient = useIsClient();
  const isPartner = useIsPartner();
  const openedAt = useRecentOpensStore((s) => s.openedAt);
  // Apps the user can access + their pinned subset.
  const availableApps = useAvailableApps();
  // One-time backfill of any pins saved client-side before server sync existed.
  useMigrateLocalAppFavorites(true);
  const { data: appFavorites = [] } = useAppFavorites();
  const appFavoritesOrder = usePMStore((s) => s.appFavoritesOrder);
  const { data: inboxUnreadCount } = useUnreadCount();
  const { data: unreadSummary } = useUnreadSummary();

  // ---- Work / Chat tab (remembered per device) ----
  const [tab, setTabState] = useState<'work' | 'chat'>(() => {
    try {
      return localStorage.getItem(TAB_KEY) === 'chat' ? 'chat' : 'work';
    } catch {
      return 'work';
    }
  });
  const setTab = (t: 'work' | 'chat') => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ }
  };
  // Opening a conversation from elsewhere (palette, notification) brings the
  // Chat tab forward so the active conversation is visible.
  useEffect(() => {
    if (homeView === 'chat') setTab('chat');
  }, [homeView]);

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
  const chatUnreadTotal = unreadEntries.reduce((n, e) => n + e.count, 0);

  const { data: workspaces } = useWorkspaces(isClient || isPartner ? undefined : workspaceId);
  const { data: areas } = useSpaces(isClient ? undefined : workspaceId);

  const recentCutoff = Date.now() - RECENT_DAYS * DAY_MS;

  // ---- Recent apps ----
  // Chips = apps opened in the last RECENT_DAYS days, most recent first. Until
  // anything has been opened, pinned apps fill the chips so the row isn't
  // empty. Everything else pinned folds under "+N More".
  const { appTiles, appMore } = useMemo(() => {
    const pinnedOrder = new Map(appFavoritesOrder.map((slug, i) => [slug, i]));
    const pinned = availableApps
      .filter((a) => appFavorites.includes(a.slug))
      .sort((a, b) => (pinnedOrder.get(a.slug) ?? 1e6) - (pinnedOrder.get(b.slug) ?? 1e6) || a.name.localeCompare(b.name));
    const recent = availableApps
      .filter((a) => (openedAt[`app:${a.slug}`] ?? 0) >= recentCutoff)
      .sort((a, b) => openedAt[`app:${b.slug}`] - openedAt[`app:${a.slug}`]);
    const tiles = recent.length ? recent : pinned;
    const tileSlugs = new Set(tiles.map((a) => a.slug));
    const overflow = recent.filter((a) => !tileSlugs.has(a.slug));
    const overflowSlugs = new Set(overflow.map((a) => a.slug));
    const older = pinned
      .filter((a) => !tileSlugs.has(a.slug) && !overflowSlugs.has(a.slug))
      .sort((a, b) => (openedAt[`app:${b.slug}`] ?? 0) - (openedAt[`app:${a.slug}`] ?? 0));
    return { appTiles: tiles, appMore: [...overflow, ...older] };
  }, [availableApps, appFavorites, appFavoritesOrder, openedAt, recentCutoff]);
  const [appsMoreOpen, setAppsMoreOpen] = useState(false);
  // Recent apps section can be folded away (remembered per device).
  const [appsCollapsed, setAppsCollapsedState] = useState(() => {
    try { return localStorage.getItem(APPS_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const toggleAppsCollapsed = () => {
    setAppsCollapsedState((c) => {
      try { localStorage.setItem(APPS_COLLAPSED_KEY, c ? '0' : '1'); } catch { /* storage unavailable */ }
      return !c;
    });
  };

  // Requirement Cards is the one app with a queue behind it — its tile carries
  // how much of the pipeline is waiting on us. Skipped when it isn't on screen.
  const cardsVisible = !appsCollapsed && appTiles.some((a) => a.slug === 'leads') || (appsMoreOpen && appMore.some((a) => a.slug === 'leads'));
  const cardsAttention = useCardsAttention(cardsVisible);

  // ---- Favorites ----
  const favoriteItemsOrder = usePMStore((s) => s.favoriteItemsOrder);
  const setFavoriteItemsOrder = usePMStore((s) => s.setFavoriteItemsOrder);
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
  // A favorite counts as recent if it was opened — or starred — lately.
  const favLastTouched = (f: Favorite) => Math.max(openedAt[f.item_id] ?? 0, Date.parse(f.created_at || '') || 0);
  const favRecent = sortedFavorites.filter((f) => favLastTouched(f) >= recentCutoff);
  const favOlder = sortedFavorites
    .filter((f) => favLastTouched(f) < recentCutoff)
    .sort((a, b) => favLastTouched(b) - favLastTouched(a));
  const [favMoreOpen, setFavMoreOpen] = useState(false);

  // DnD state for favorites
  const [dragFavId, setDragFavId] = useState<string | null>(null);
  const [overFav, setOverFav] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);

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

  const favSnapshot = (fav: Favorite) => {
    if (fav.item_type === 'channel') return buildChatSnapshot(fav.item_id, 'channel');
    if (fav.item_type === 'list') return buildListSnapshot(fav.space_id || '', fav.item_id);
    if (fav.item_type === 'space') return buildSpaceSnapshot(fav.item_id);
    if (fav.item_type === 'folder') return buildFolderSnapshot(fav.space_id || '', fav.item_id);
    return null;
  };
  const openFav = (fav: Favorite, e?: React.MouseEvent) => {
    if (e && wantsNewTab(e)) {
      const snap = favSnapshot(fav);
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

  const launchApp = (app: AppDef, e: React.MouseEvent) => {
    if (app.view && wantsNewTab(e)) {
      e.preventDefault();
      useTabsStore.getState().openInNewTab(buildAppSnapshot(app.view, 'home'), { background: e.button === 1 });
      return;
    }
    onLaunchApp(app);
  };

  const { data: crmChats = [] } = useCrmChats(workspaceId);
  const closeCrmChat = useCloseCrmChat(workspaceId);
  const openChatPanel = useChatSidePanelStore((s) => s.open);
  const activePanelChannelId = useChatSidePanelStore((s) => (s.isOpen ? s.channelId : null));
  const openCrmChat = (ch: (typeof crmChats)[number]) =>
    openChatPanel({
      channelId: ch.channel_id,
      containerLabel: ch.subtitle ? `${ch.label} · ${ch.subtitle}` : ch.label,
      isCrmChat: true,
      crmEntityType: ch.entity_type,
      crmEntityId: ch.entity_id,
    });

  // ---- Sidebar search ----
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const closeFind = () => { setFindOpen(false); setFindQ(''); };
  // Area/workspace contents (folders + lists) only load when a row is expanded;
  // fetch them all once search opens so it can reach every list.
  const spaceIds = useMemo(
    () => [...(areas ?? []), ...(workspaces ?? [])].map((s) => s.id),
    [areas, workspaces],
  );
  useEffect(() => {
    if (!findOpen) return;
    for (const id of spaceIds) {
      void queryClient.prefetchQuery({
        queryKey: ['space', id],
        queryFn: async () => (await api.get(`/pm/spaces/${id}`)).data.data,
        staleTime: 60_000,
      });
    }
  }, [findOpen, spaceIds, queryClient]);

  const dmLabel = (dm: DmConversation) => {
    const others = (dm.participants || []).filter((p) => p.id !== meId);
    if (others.length === 0) return 'Just you';
    if (others.length === 1) return others[0].display_name;
    if (others.length === 2) return `${others[0].display_name}, ${others[1].display_name}`;
    return `${others[0].display_name} + ${others.length - 1}`;
  };

  const q = findQ.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!findOpen || !q) return [];
    const done = closeFind;
    const go = (fn: () => void) => () => { fn(); done(); };
    const entries: SearchEntry[] = [];
    const add = (e: SearchEntry) => entries.push(e);

    const menu: Array<[string, string, HomeView]> = [
      ['My home', ICON.home, 'hub'],
      ['Inbox', ICON.inbox, 'inbox'],
      ...(!isClient ? ([['My Day', ICON.day, 'day-planner'], ['Routines', ICON.routines, 'routines']] as Array<[string, string, HomeView]>) : []),
      ['My Tasks', ICON.tasks, 'my-tasks'],
      ['Goals', ICON.goals, 'goals'],
      ...(isPartner ? ([['Opportunities', ICON.opportunities, 'opportunities']] as Array<[string, string, HomeView]>) : []),
    ];
    menu.forEach(([name, d, view]) => add({ key: `m:${view}`, name, d, meta: 'Menu', open: go(() => onChangeView(view)) }));
    availableApps.forEach((app) => add({ key: `a:${app.slug}`, name: app.name, d: app.paths.join(' '), meta: 'App', open: go(() => onLaunchApp(app)) }));
    sortedFavorites.forEach((fav) => add({ key: `f:${fav.id}`, name: fav.item_name || 'Untitled', d: favoriteIconPath(fav.item_type), meta: 'Favorite', open: go(() => openFav(fav)) }));

    const openList = (spaceId: string, listId: string) => go(() => { setActiveSpace(spaceId); setActiveList(listId); onChangeView('tasks'); });
    const openFolder = (spaceId: string, f: Folder) => go(() => {
      setActiveSpace(spaceId);
      if (f.client_space_template_id) setActiveDesignFolder(f.id);
      else setActiveFolder(f.id);
      onChangeView('tasks');
    });
    const addContents = (space: Space, root: string) => {
      const folders = space.folders ?? [];
      const byId = new Map(folders.map((f) => [f.id, f]));
      for (const f of folders) {
        const parent = f.parent_folder_id ? byId.get(f.parent_folder_id) : undefined;
        const where = parent ? `${root} / ${parent.name}` : root;
        const isWorkspaceClient = f.folder_type === 'client';
        add({
          key: `fo:${f.id}`,
          name: f.name,
          d: isWorkspaceClient ? ICON.person : f.client_space_template_id ? ICON.space : ICON.folder,
          meta: `${isWorkspaceClient ? 'Workspace' : f.client_space_template_id ? 'Space' : 'Folder'} · ${where}`,
          open: openFolder(space.id, f),
        });
        for (const l of (f as Folder & { lists?: List[] }).lists ?? []) {
          add({ key: `l:${l.id}`, name: l.name, d: ICON.list, meta: `List · ${where} / ${f.name}`, open: openList(space.id, l.id) });
        }
      }
      for (const l of space.lists ?? []) {
        add({ key: `l:${l.id}`, name: l.name, d: ICON.list, meta: `List · ${root}`, open: openList(space.id, l.id) });
      }
    };
    for (const ws of workspaces ?? []) {
      const full = queryClient.getQueryData<Space>(['space', ws.id]);
      if (full) addContents(full, 'Workspaces');
    }
    for (const area of areas ?? []) {
      add({
        key: `s:${area.id}`,
        name: area.name,
        d: ICON.space,
        meta: 'Area',
        open: go(() => { setActiveSpace(area.id); setActiveSpacePage(area.id); onChangeView('tasks'); }),
      });
      const full = queryClient.getQueryData<Space>(['space', area.id]);
      if (full) addContents(full, area.name);
    }
    (sharedItems ?? []).forEach((item) => add({
      key: `sh:${item.id}`,
      name: item.resource_name,
      d: favoriteIconPath(item.resource_type),
      meta: 'Shared with me',
      open: go(() => { if (item.resource_type === 'list') { setActiveSpace(item.space_id); setActiveList(item.resource_id); onChangeView('tasks'); } }),
    }));
    visibleChannels.forEach((ch) => add({ key: `c:${ch.id}`, name: ch.name, d: ICON.channel, meta: 'Channel', open: go(() => onSelectChannel(ch.id)) }));
    dms.forEach((dm) => add({ key: `d:${dm.id}`, name: dmLabel(dm), d: ICON.chat, meta: 'Direct message', open: go(() => onSelectDm(dm.id)) }));
    crmChats.forEach((ch) => add({ key: `cr:${ch.channel_id}`, name: ch.label, d: ICON.chat, meta: 'CRM chat', open: go(() => openCrmChat(ch)) }));

    const seen = new Set<string>();
    return entries
      .filter((e) => {
        if (seen.has(e.key) || !e.name.toLowerCase().includes(q)) return false;
        seen.add(e.key);
        return true;
      })
      .slice(0, 30);
    // Rebuilt per keystroke — the index is small and reads fresh query cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, q, availableApps, sortedFavorites, workspaces, areas, sharedItems, visibleChannels, dms, crmChats, isClient, isPartner, meId]);

  const highlight = (name: string) => {
    const i = name.toLowerCase().indexOf(q);
    if (i < 0) return name;
    return (
      <>
        {name.slice(0, i)}
        <span className="rounded-[3px] bg-[var(--sh-hair)] font-semibold text-[var(--sh-ink)]">{name.slice(i, i + q.length)}</span>
        {name.slice(i + q.length)}
      </>
    );
  };

  const addButton = (title: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
    >
      <Icon d={ICON.plus} className="h-[14px] w-[14px]" />
    </button>
  );

  const segment = (active: boolean) =>
    `flex h-7 items-center justify-center gap-[6px] rounded-full text-[12.5px] font-semibold transition ${
      active
        ? 'bg-[var(--surface)] text-[var(--sh-ink)] shadow-[0_0_0_0.5px_rgba(16,24,40,.08),0_1px_2px_rgba(16,24,40,.10),0_3px_8px_-1px_rgba(16,24,40,.10)] dark:bg-[var(--sh-hair-2)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_1px_2px_rgba(0,0,0,.45),0_3px_8px_-1px_rgba(0,0,0,.4)]'
        : 'text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]'
    }`;

  return (
    <div className="group/sidebar flex h-full w-full flex-col text-[var(--sh-ink-2)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        {/* Brand lockup — "SquadHub" with a "Powered by UpSquad" subtitle */}
        <div className="flex items-center gap-[10px]">
          <BotFace />
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

      {/* Everything below the brand row scrolls as one — search, tiles, apps,
          Work/Chat switch and the tree all move together. */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      {/* Search — a grey pill that opens the workspace palette */}
      <div className="px-3 pt-[2px] pb-[6px]">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-[30px] w-full items-center gap-[7px] rounded-full bg-[var(--sh-hair-3)] pl-[11px] pr-1 text-left text-[12px] font-medium text-[var(--sh-ink-4)] transition hover:bg-[var(--sh-hair)] hover:text-[var(--sh-ink-3)]"
          title="Search (⌘K)"
          aria-label="Open workspace search"
        >
          <Icon d={ICON.search} className="h-[13px] w-[13px] shrink-0" />
          <span className="flex-1 truncate">Search or jump to…</span>
          <span className="grid h-[22px] min-w-[26px] place-items-center rounded-full bg-[var(--sidebar)] px-[6px] text-[9.5px] font-semibold text-[var(--sh-ink-3)] shadow-[inset_0_0_0_1px_var(--sh-hair-2)]">⌘K</span>
        </button>
      </div>

      {/* Primary nav — 3-up tiles */}
      <div className="grid grid-cols-3 gap-[6px] px-3 py-1">
        <NavTile icon={ICON.home} label="My home" active={homeView === 'hub'} onClick={() => onChangeView('hub')} />
        <NavTile
          icon={ICON.inbox}
          label="Inbox"
          active={homeView === 'inbox'}
          count={inboxUnreadCount ?? 0}
          alert={inboxAlert}
          pulse={inboxPulse}
          onClick={() => onChangeView('inbox')}
        />
        {/* My Day + Routines — hidden for client / client-staff users. */}
        {!isClient && (
          <>
            <NavTile icon={ICON.day} label="My Day" active={homeView === 'day-planner'} onClick={() => onChangeView('day-planner')} />
            <NavTile icon={ICON.routines} label="Routines" active={homeView === 'routines'} onClick={() => onChangeView('routines')} />
          </>
        )}
        <NavTile icon={ICON.tasks} label="My Tasks" active={homeView === 'my-tasks'} onClick={() => onChangeView('my-tasks')} />
        <NavTile icon={ICON.goals} label="Goals" active={homeView === 'goals'} onClick={() => onChangeView('goals')} />
        {isPartner && (
          <PartnerOpportunitiesTile active={homeView === 'opportunities'} onClick={() => onChangeView('opportunities')} />
        )}
      </div>

      {/* ---- Recent apps ---- */}
      {availableApps.length > 0 && (
        <div data-tip-anchor="home.apps">
          <div className="flex items-center justify-between px-4 pt-[14px] pb-[6px]">
            <button
              type="button"
              onClick={toggleAppsCollapsed}
              aria-expanded={!appsCollapsed}
              title={appsCollapsed ? 'Show apps' : 'Hide apps'}
              className="group/apps flex min-w-0 items-center gap-[5px] text-[var(--sh-ink-3)] transition hover:text-[var(--sh-ink)]"
            >
              <span className="sb-section truncate">Recent apps</span>
              {appsCollapsed && (
                <span className="rounded-full bg-[var(--sh-hair-3)] px-[6px] py-[2px] text-[10.5px] font-medium leading-none text-[var(--sh-ink-3)]">
                  {availableApps.length}
                </span>
              )}
              <svg
                className={`h-3 w-3 shrink-0 text-[var(--sh-ink-4)] transition-transform duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/apps:text-[var(--sh-ink)] ${appsCollapsed ? '-rotate-90' : ''}`}
                viewBox="0 0 18 18"
                fill="currentColor"
                aria-hidden
              >
                <path d="M5 7h8L9 11z" />
              </svg>
            </button>
            <button type="button" onClick={onOpenApps} className="shrink-0 text-[11.5px] font-medium text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]">
              All apps
            </button>
          </div>
          <TreeCollapse open={!appsCollapsed}>
          <div className="flex flex-wrap gap-[6px] px-3">
            {appTiles.map((app) => {
              const active = !!app.view && homeView === app.view;
              return (
                <button
                  key={app.slug}
                  type="button"
                  title={app.name}
                  onClick={(e) => launchApp(app, e)}
                  onAuxClick={(e) => { if (e.button === 1) launchApp(app, e); }}
                  className={`sb-chip relative flex h-7 max-w-full items-center gap-[6px] rounded-[8px] pl-2 pr-[10px] text-[11.5px] font-medium transition ${
                    active
                      ? 'bg-[var(--surface)] text-[var(--sh-ink)] shadow-[var(--sh-shadow-sm)] ring-1 ring-inset ring-[var(--sh-hair-2)]'
                      : 'text-[var(--sh-ink-2)] shadow-[inset_0_0_0_1px_var(--sh-hair-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
                  }`}
                >
                  <AppIcon paths={app.paths} className="h-[13px] w-[13px] shrink-0" />
                  <span className="min-w-0 truncate">{app.name}</span>
                  {app.slug === 'leads' && cardsAttention.total > 0 && (
                    <span
                      title={cardsAttention.parts.join(' · ')}
                      className="absolute -right-1 -top-1 grid h-[14px] min-w-[14px] place-items-center rounded-full px-[3px] text-[9px] font-bold text-[#0a0a0a] shadow-[0_0_0_2px_var(--sidebar)]"
                      style={{ background: 'var(--color-sh-warning)' }}
                    >
                      {cardsAttention.total > 99 ? '99+' : cardsAttention.total}
                    </span>
                  )}
                  {(app.slug === 'squadcrm-teamchat' || app.slug === 'squadhire-teamchat') && (
                    <span className="absolute -right-1 -top-1 flex">
                      <TeamChatAppBadge source={app.slug === 'squadcrm-teamchat' ? 'crm' : 'shcrm'} />
                    </span>
                  )}
                </button>
              );
            })}
            {appMore.length > 0 && (
              <button
                type="button"
                title={`Not opened in the last ${RECENT_DAYS} days`}
                onClick={() => setAppsMoreOpen((o) => !o)}
                className="flex h-7 select-none items-center gap-1 rounded-[8px] border border-dashed border-[var(--sh-hair-2)] px-[10px] text-[11.5px] font-medium text-[var(--sh-ink-3)] transition hover:text-[var(--sh-ink)]"
              >
                <span>{appsMoreOpen ? '−' : `+${appMore.length}`}</span>
                <span>{appsMoreOpen ? 'Less' : 'More'}</span>
              </button>
            )}
          </div>
          {appsMoreOpen && appMore.length > 0 && (
            <div className="mx-3 mt-[6px] rounded-[12px] bg-[var(--sh-hair-3)] p-1">
              {appMore.map((app) => (
                <button
                  key={app.slug}
                  type="button"
                  onClick={(e) => launchApp(app, e)}
                  onAuxClick={(e) => { if (e.button === 1) launchApp(app, e); }}
                  className="flex w-full items-center gap-[9px] rounded-[8px] px-2 py-[6px] text-left text-[13px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair)] hover:text-[var(--sh-ink)]"
                >
                  <AppIcon paths={app.paths} className="h-[14px] w-[14px] shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{app.name}</span>
                  <span className="text-[11px] tabular-nums text-[var(--sh-ink-4)]">{ageLabel(openedAt[`app:${app.slug}`])}</span>
                </button>
              ))}
            </div>
          )}
          </TreeCollapse>
        </div>
      )}

      {/* Work / Chat switch */}
      <div className="mx-3 mt-[10px] mb-[2px] grid grid-cols-2 rounded-full bg-[var(--sh-hair-3)] p-[3px]" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'work'} onClick={() => setTab('work')} className={segment(tab === 'work')}>
          Work
        </button>
        <button type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')} className={segment(tab === 'chat')}>
          Chat
          {chatUnreadTotal > 0 && (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[var(--sh-ink)] px-[5px] text-[10px] font-semibold text-[var(--sidebar)]">
              {chatUnreadTotal > 99 ? '99+' : chatUnreadTotal}
            </span>
          )}
        </button>
      </div>

      <div>
        {tab === 'work' && (
          <>
            {/* ---- Favorites (header doubles as the sidebar search) ---- */}
            {!findOpen ? (
              <SectionLabel
                title="Favorites"
                action={<HeaderIconButton title="Search the sidebar" onClick={() => setFindOpen(true)} d={ICON.search} />}
              />
            ) : (
              <div className="px-3 pt-3 pb-1">
                <div className="flex h-[30px] items-center gap-[7px] rounded-[10px] bg-[var(--sh-hair-3)] pl-[10px] pr-1 text-[var(--sh-ink-3)] shadow-[inset_0_0_0_1px_var(--sh-hair-2)]">
                  <Icon d={ICON.search} className="h-[13px] w-[13px] shrink-0" />
                  <input
                    autoFocus
                    value={findQ}
                    onChange={(e) => setFindQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') closeFind();
                      if (e.key === 'Enter' && searchResults[0]) searchResults[0].open();
                    }}
                    placeholder="Search the sidebar"
                    className="h-full min-w-0 flex-1 border-0 bg-transparent text-[12.5px] font-medium text-[var(--sh-ink)] outline-none placeholder:text-[var(--sh-ink-4)]"
                  />
                  <HeaderIconButton title="Close search" onClick={closeFind} d="M6 6l12 12M18 6 6 18" />
                </div>
              </div>
            )}

            {findOpen && q ? (
              <div className="px-2 pt-1">
                <div className="px-2 pt-1 pb-[6px] text-[11px] text-[var(--sh-ink-4)]">
                  {searchResults.length
                    ? `${searchResults.length} ${searchResults.length === 1 ? 'match' : 'matches'}`
                    : `No matches for “${findQ.trim()}”`}
                </div>
                {searchResults.map((r) => (
                  <button key={r.key} type="button" title={r.name} onClick={r.open} className={`${ROW} ${ROW_IDLE}`}>
                    <span className="text-[var(--sh-ink-3)]"><Icon d={r.d} /></span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{highlight(r.name)}</span>
                      <span className="truncate text-[11px] text-[var(--sh-ink-4)]">{r.meta}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="px-2">
                  {favoritesLoading && <p className="px-2 py-[5px] text-[11.5px] text-[var(--sh-ink-4)]">Loading...</p>}
                  {!favoritesLoading && sortedFavorites.length === 0 && (
                    <p className="px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">Star items to pin them here</p>
                  )}
                  {[...favRecent, ...(favMoreOpen ? favOlder : [])].map((fav) => {
                    const older = !favRecent.includes(fav);
                    return (
                      <div
                        key={fav.id}
                        draggable={!older}
                        onDragStart={() => setDragFavId(fav.id)}
                        onDragOver={(e) => handleFavDragOver(e, fav.id)}
                        onDrop={(e) => handleFavDrop(e, fav.id)}
                        onDragEnd={handleFavDragEnd}
                        className="sb-tree-node relative rounded-[10px]"
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
                          type="button"
                          title={fav.item_name}
                          onClick={(e) => openFav(fav, e)}
                          onAuxClick={(e) => { if (e.button === 1) openFav(fav, e); }}
                          className={`${ROW} ${older ? 'text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]' : ROW_IDLE}`}
                        >
                          <span className={older ? 'text-[var(--sh-ink-4)]' : 'text-[var(--sh-ink-3)]'}>
                            <Icon d={favoriteIconPath(fav.item_type)} />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{fav.item_name}</span>
                          {older && <span className="text-[11px] tabular-nums text-[var(--sh-ink-4)]">{ageLabel(favLastTouched(fav))}</span>}
                        </button>
                        <div className="sb-row-acts sb-row-acts--row">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeFavorite.mutate(fav.id); }}
                            className="rounded p-0.5 text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
                            title="Remove from favorites"
                          >
                            <Icon d="M6 6l12 12M18 6 6 18" className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {favOlder.length > 0 && (
                    <button
                      type="button"
                      title={`Not opened in the last ${RECENT_DAYS} days`}
                      onClick={() => setFavMoreOpen((o) => !o)}
                      className="flex w-full select-none items-center gap-[9px] rounded-[10px] px-[10px] py-[6px] text-left text-[13px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                    >
                      <span className="flex w-[14px] justify-center text-[var(--sh-ink-4)]">
                        <svg className={`h-3 w-3 transition-transform duration-[140ms] ${favMoreOpen ? '' : '-rotate-90'}`} viewBox="0 0 18 18" fill="currentColor">
                          <path d="M5 7h8L9 11z" />
                        </svg>
                      </span>
                      <span className="flex-1">{favMoreOpen ? 'Show less' : 'More'}</span>
                      <span className="rounded-full bg-[var(--sh-hair-3)] px-[6px] py-[2px] text-[10.5px] font-medium leading-none text-[var(--sh-ink-3)]">
                        {favOlder.length}
                      </span>
                    </button>
                  )}
                </div>

                {/* ---- Workspaces ---- */}
                {!isPartner && !isClient && (
                  <>
                    <SectionLabel
                      title="Workspaces"
                      action={canCreateFolders && workspaces?.length ? addButton('Create workspace', () => setShowCreateWorkspace(true)) : undefined}
                    />
                    <div className="px-2">
                      <WorkspaceTree workspaceId={workspaceId} />
                    </div>
                    {showCreateWorkspace && workspaces?.[0] && (
                      <CreateFolderListModal type="client" spaceId={workspaces[0].id} onClose={() => setShowCreateWorkspace(false)} />
                    )}
                  </>
                )}

                {/* ---- Areas ---- */}
                <SectionLabel title="Areas" action={canCreateSpaces ? addButton('Create area', () => setShowCreateSpace(true)) : undefined} />
                <div className="px-2">
                  <SpaceTree workspaceId={workspaceId} onRequestCreate={() => setShowCreateSpace(true)} />
                </div>
                {showCreateSpace && <CreateSpaceModal workspaceId={workspaceId} onClose={() => setShowCreateSpace(false)} />}

                {/* ---- Shared with me ---- */}
                {!isPartner && !isClient && sharedItems && sharedItems.length > 0 && (
                  <>
                    <SectionLabel title="Shared with me" />
                    <div className="px-2">
                      {sharedLoading && <p className="px-2 py-[5px] text-[11.5px] text-[var(--sh-ink-4)]">Loading...</p>}
                      {sharedItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          title={item.resource_name}
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
                          className={`${ROW} ${ROW_IDLE}`}
                        >
                          <span className="text-[var(--sh-ink-3)]"><Icon d={favoriteIconPath(item.resource_type)} /></span>
                          <span className="truncate">{item.resource_name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {tab === 'chat' && (
          <>
            {/* ---- Unread ---- */}
            {unreadEntries.length > 0 && (
              <>
                <SectionLabel title="Unread" />
                <div className="px-2">
                  {unreadEntries.map((entry) =>
                    entry.kind === 'channel' ? (
                      <button
                        key={`channel-${entry.channel.id}`}
                        type="button"
                        onClick={() => onSelectChannel(entry.channel.id)}
                        className={`${ROW} font-medium text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)]`}
                      >
                        <span className="-mr-[3px] text-[var(--sh-ink-4)]">#</span>
                        <span className="flex-1 truncate">{entry.channel.name}</span>
                        <UnreadBadge count={entry.count} />
                      </button>
                    ) : (
                      <DmListItem
                        key={`dm-${entry.dm.id}`}
                        dm={entry.dm}
                        active={activeChannelId === entry.dm.id && activeChannelKind === 'dm' && homeView === 'chat'}
                        unreadCount={entry.count}
                        onClick={() => onSelectDm(entry.dm.id)}
                      />
                    ),
                  )}
                </div>
              </>
            )}

            {/* ---- Channels ---- */}
            <SectionLabel title="Channels" action={canCreateChannels ? addButton('Create channel', onCreateChannel) : undefined} />
            <div className="px-2">
              {visibleChannels.length === 0 ? (
                <p className="px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">No channels yet</p>
              ) : (
                visibleChannels.map((ch) => {
                  const isActive = activeChannelId === ch.id && homeView === 'chat';
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => onSelectChannel(ch.id)}
                      className={`${ROW} ${isActive ? ROW_ACTIVE : ROW_IDLE}`}
                    >
                      <span className={`-mr-[3px] ${isActive ? 'text-[var(--sh-ink-3)]' : 'text-[var(--sh-ink-4)]'}`}>#</span>
                      <span className="flex-1 truncate">{ch.name}</span>
                      <UnreadBadge count={unreadSummary?.channels[ch.id] ?? 0} />
                    </button>
                  );
                })
              )}
            </div>

            {/* ---- Direct Messages ---- */}
            <SectionLabel title="Direct Messages" action={canSendDms ? addButton('New direct message', () => setShowNewDm(true)) : undefined} />
            <div className="px-2">
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
            </div>
            {showNewDm && <NewDmModal workspaceId={workspaceId} onClose={() => setShowNewDm(false)} />}

            {/* ---- CRM Chats ---- */}
            <SectionLabel title="CRM Chats" />
            <div className="px-2">
              {crmChats.length === 0 ? (
                <p className="px-2 py-2 text-[11.5px] leading-snug text-[var(--sh-ink-4)]">
                  No open CRM chats. Open a deal or contact in CRM and start a team chat.
                </p>
              ) : (
                crmChats.map((ch) => {
                  const isActive = activePanelChannelId === ch.channel_id;
                  return (
                    <div key={ch.channel_id} className="sb-tree-node relative">
                      <button
                        type="button"
                        title={ch.label}
                        onClick={() => openCrmChat(ch)}
                        className={`${ROW} gap-2 ${isActive ? ROW_ACTIVE : ROW_IDLE}`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            ch.entity_type === 'crm_deal' ? 'bg-indigo-500' : ch.entity_type === 'crm_contact' ? 'bg-sky-500' : 'bg-emerald-600'
                          }`}
                        />
                        <span className="truncate">{ch.label}</span>
                      </button>
                      <div className="sb-row-acts sb-row-acts--row">
                        <button
                          type="button"
                          title="Close chat"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeCrmChat.mutate(ch.channel_id);
                          }}
                          className="grid h-[18px] w-[18px] place-items-center rounded text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function PartnerOpportunitiesTile({
  active, onClick,
}: { active: boolean; onClick: () => void }) {
  const { data } = useQuery({
    queryKey: ['partner-opportunities-pending'],
    queryFn: () => api.get('/partner/opportunities?status=pending').then((r) => r.data),
    refetchInterval: 30_000,
  });
  const pending: SubscriptionCardRecipient[] = data?.data || [];

  return <NavTile icon={ICON.opportunities} label="Opportunities" active={active} count={pending.length} onClick={onClick} />;
}
