'use client';

/**
 * MobileShell — the phone chrome for SquadHub web.
 *
 * This is a port of the SquadHub **Business Android app**'s navigation shell
 * (`ui/tabs/MainTabs.kt` + `ui/components/SlackKit.kt`) onto the web app:
 *
 *   carbon header  →  white sheet (rounded top)  →  flat bottom bar, an
 *   accent indicator pill, red count badges, a carbon FAB on Home, and a left
 *   account drawer behind the avatar. Partner roles also get Discover between
 *   Inbox and More; the Business app keeps its existing four tabs.
 *
 * It does NOT fork the app's features. Tab roots are phone-shaped surfaces
 * (spaces-first Home, a conversation list, the More menu); everything the
 * user drills into is the *same* pane the desktop renders, handed in as
 * `renderPane`. That keeps one implementation of lists, chat, the inbox and
 * task details, so the mobile view can't drift behind the desktop one.
 *
 * Drilled-in screens hide the bottom bar, gain a back app bar, and — as on
 * Android — respond to a right-swipe and the hardware/browser Back button.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Channel, DmConversation, Favorite, SubscriptionCardRecipient, User } from '@squadhub/shared';
import type { ActiveSection, HomeView } from '../layouts/MainLayout';
import { launchApp, type AppDef } from '../config/apps';
import { useIsClient, useIsPartner } from '../hooks/useUserType';
import { usePMStore } from '../stores/pmStore';
import MobileHome, { applyOpenTarget } from './MobileHome';
import MobilePartnerHome from './MobilePartnerHome';
import MobileChat from './MobileChat';
import MobileDiscover from './MobileDiscover';
import MobileMore, { MobileSettings, type MoreTarget } from './MobileMore';
import MobileCreateSheet from './MobileCreateSheet';
import MobileTour, { hasSeenMobileTour } from './MobileTour';
import { MAvatar, MIcon, MRow } from './MobileKit';
import type { OpenTarget } from './useMobileSpaces';
import api from '../services/api';
import TalentShell from './TalentShell';

type MTab = 'home' | 'chat' | 'inbox' | 'discover' | 'more';

const BUSINESS_TABS: { key: MTab; label: string; outline: ReactNode; filled: ReactNode }[] = [
  { key: 'home', label: 'Home', outline: MIcon.homeOutline, filled: MIcon.home },
  { key: 'chat', label: 'Chat', outline: MIcon.chatOutline, filled: MIcon.chat },
  { key: 'inbox', label: 'Inbox', outline: MIcon.inboxOutline, filled: MIcon.inbox },
  { key: 'more', label: 'More', outline: MIcon.moreOutline, filled: MIcon.more },
];

const PARTNER_TABS: typeof BUSINESS_TABS = [
  ...BUSINESS_TABS.slice(0, 3),
  { key: 'discover', label: 'Discover', outline: MIcon.discoverOutline, filled: MIcon.discover },
  BUSINESS_TABS[3],
];

/** Tabs that draw the carbon header behind the status bar (PURPLE_ROUTES). */
const CARBON_TABS = new Set<MTab>(['home', 'chat']);

export interface MobileShellProps {
  user: User | null;
  workspaceId: string | undefined;
  channels: Channel[];
  dms: DmConversation[];
  inboxUnread: number;
  supportChannelId: string | null;
  supportUnread: number;
  /** Renders the live desktop pane for the current nav state. */
  renderPane: () => ReactNode;
  setActiveSection: (s: ActiveSection) => void;
  setHomeView: (v: HomeView) => void;
  setActiveChannel: (id: string, kind: 'channel' | 'dm') => void;
  onOpenSearch: () => void;
  onNewDm: () => void;
  onLogout: () => void;
  /** In-flow banners (emergency tasks, running timers) — they're not fixed, so
      they have to live inside the sheet rather than behind it. */
  banner?: ReactNode;
  /** Fixed-position widgets that must stack inside the shell's context. */
  floating?: ReactNode;
}

export default function MobileShell({
  user,
  workspaceId,
  channels,
  dms,
  inboxUnread,
  supportChannelId,
  supportUnread,
  renderPane,
  setActiveSection,
  setHomeView,
  setActiveChannel,
  onOpenSearch,
  onNewDm,
  onLogout,
  banner,
  floating,
}: MobileShellProps) {
  // Business app UI (spaces-first Home) for client AND client_staff. Partner
  // app UI (Focus/Favorites Home) for everyone else — internal, partner,
  // partner_employee.
  // Partner roles use the redesigned five-tab shell; the Business app keeps
  // its established four-tab navigation.
  const isClient = useIsClient();
  const isPartner = useIsPartner();
  // Top-level Work | Discover switcher — mirrors Yubo's Swipe / Near you pill.
  // Work = current SquadHub shell; Discover = full Squad Hire talent app (Profiles frontend)
  // embedded with its own bottom nav (TalentBottomNav). Persisted so a refresh keeps the surface.
  const [surface, setSurface] = useState<'work' | 'discover'>(() => {
    if (typeof window === 'undefined') return 'work';
    try { return (localStorage.getItem('msh-surface') as 'work' | 'discover') || 'work'; } catch { return 'work'; }
  });
  useEffect(() => { try { localStorage.setItem('msh-surface', surface); } catch {} }, [surface]);
  // Work tabs deliberately exclude Discover — Discover now lives as its own surface with the talent app's bottom nav.
  const tabs = BUSINESS_TABS;
  const { data: discoverPendingData } = useQuery({
    queryKey: ['partner-opportunities-pending'],
    queryFn: () => api.get('/partner/opportunities?status=pending').then((r) => r.data),
    enabled: isPartner,
    refetchInterval: 30_000,
  });
  const discoverUnread = Array.isArray(discoverPendingData?.data)
    ? (discoverPendingData.data as SubscriptionCardRecipient[]).filter((item) => {
        const expiresAt = (item.card as (typeof item.card & { expires_at?: string | null }))?.expires_at;
        return !expiresAt || new Date(expiresAt).getTime() > Date.now();
      }).length
    : 0;

  const [tab, setTab] = useState<MTab>('home');
  const [chatQuery, setChatQuery] = useState('');
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  // Non-null while drilled into a screen. `target` is the space/list it opened
  // (null for screens with no PM scope, e.g. a conversation or Calendar), and
  // is what the create sheet pre-selects when you tap + inside that screen.
  // `bare` drops the app-bar title: the screen paints the app's large in-body
  // header instead (TasksScreen.kt has no top bar, just back + 28sp title).
  const [section, setSection] = useState<{ title: string; target: OpenTarget | null; bare?: boolean } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // null = closed; otherwise the space the sheet should pre-target (undefined
  // for the FAB, which starts with no space chosen).
  const [creating, setCreating] = useState<{ preset: OpenTarget | null } | null>(null);
  const [tourOpen, setTourOpen] = useState(() => !hasSeenMobileTour(user?.id));

  // Live mirrors of the two pieces of state the popstate listener needs; it's
  // registered once, so it can't close over their current values.
  const sectionRef = useRef<typeof section>(null);
  sectionRef.current = section;
  const tabRef = useRef<MTab>(tab);
  tabRef.current = tab;

  // ---- Tab roots -------------------------------------------------------
  // Each root parks the shared nav state on a known view so that if the user
  // drills in and comes back, `renderPane` isn't left pointing at a stale one.
  const goRoot = useCallback(
    (t: MTab) => {
      setSection(null);
      usePMStore.getState().setActiveDashboardTab(null);
      setActiveSection('home');
      setHomeView(t === 'inbox' ? 'inbox' : 'hub');
    },
    [setActiveSection, setHomeView],
  );

  // Only reachable from the tab bar, which is hidden inside a section — so
  // there's never a pushed history entry to clean up here.
  const selectTab = (t: MTab) => {
    setTab(t);
    if (t !== 'chat') {
      setChatSearchOpen(false);
      setChatQuery('');
    }
    goRoot(t);
  };

  // ---- Drilling in / out ----------------------------------------------
  // Entering a screen pushes a history entry so the browser's Back button (and
  // Android's system back) pops it, exactly like the native app's back stack.
  const openSection = useCallback((title: string, target: OpenTarget | null = null, bare = false) => {
    setSection({ title, target, bare });
    window.history.pushState({ mshSection: true }, '');
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (sectionRef.current !== null) goRoot(tabRef.current);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [goRoot]);

  // The visible Back control goes through history so the entry we pushed is
  // consumed — otherwise Back would need two presses to leave the screen.
  const goBack = () => {
    if (section !== null) window.history.back();
  };

  // Right-swipe from anywhere in a section pops it (MainTabs' drag gesture).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (section === null) return;
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || section === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Horizontal, decisive, and started near the left edge — so it can't be
    // confused with a scroll or with dragging content sideways.
    if (dx > 80 && Math.abs(dy) < 60 && start.x < 60) goBack();
  };

  // ---- Openers ---------------------------------------------------------
  const openTarget = (t: OpenTarget) => {
    applyOpenTarget(t);
    setActiveSection('home');
    setHomeView('tasks');
    // Lists/spaces/folders paint mtk-phone-head; back-only app bar like Android.
    openSection(t.title, t, true);
  };

  const openConversation = (id: string, kind: 'channel' | 'dm', title: string) => {
    setActiveChannel(id, kind);
    setActiveSection('home');
    setHomeView('chat');
    openSection(title);
  };

  const openMore = (t: MoreTarget) => {
    if (t.kind === 'settings') {
      openSection('Settings');
      return;
    }
    if (t.kind === 'view') {
      setActiveSection('home');
      setHomeView(t.view);
      if (t.view === 'my-tasks') usePMStore.getState().setActiveDashboardTab(null);
      // My Tasks / Check-in / Meetings paint the app's own large header.
      const bare = t.view === 'my-tasks' || t.view === 'checkin' || t.view === 'meetings';
      openSection(t.title, null, bare);
      return;
    }
    if (t.kind === 'section') {
      setActiveSection(t.section);
      openSection(t.title);
      return;
    }
    // Apps: internal ones open a view; link-outs (SquadBooks) hand off with an
    // SSO token and never become a section here.
    const app: AppDef = t.app;
    launchApp(app, {
      workspace: workspaceId ? { id: workspaceId, name: '' } : null,
      openView: (v) => {
        setActiveSection('home');
        setHomeView(v);
        openSection(app.name);
      },
    });
  };

  // Inline "+" on a Home card — the sheet opens already pointed at that space.
  const createIn = (t: OpenTarget) => setCreating({ preset: t });

  const openPartnerFavorite = (favorite: Favorite) => {
    const title = favorite.item_name || 'Favorite';
    if (favorite.item_type === 'channel') {
      openConversation(favorite.item_id, 'channel', title);
      return;
    }
    if (favorite.item_type === 'space') {
      openTarget({ kind: 'space', id: favorite.item_id, title });
      return;
    }
    if (!favorite.space_id) return;
    if (favorite.item_type === 'folder') {
      openTarget({ kind: 'folder', id: favorite.item_id, spaceId: favorite.space_id, title });
      return;
    }
    openTarget({ kind: 'list', id: favorite.item_id, spaceId: favorite.space_id, title });
  };

  // ---- Chrome decisions ------------------------------------------------
  const onSection = section !== null;
  const carbonHeader = !onSection && CARBON_TABS.has(tab);
  // Inbox and More paint their own large-title / profile chrome, matching the
  // native apps. Only drilled-in screens use the generic back app bar.
  const showAppBar = onSection;
  const title = section?.title ?? '';
  const settingsOpen = onSection && section?.title === 'Settings';
  // Home always offers create; inside a space/list the + files straight into it.
  const fabTarget = onSection ? section.target : null;
  const showFab = onSection ? !!fabTarget : tab === 'home';
  const tabBar = !onSection && (
    <nav className="msh-tabbar" data-tour="tabbar">
      <div className="msh-tabbar-row">
        {tabs.map((t) => {
          const on = tab === t.key;
          const badge = t.key === 'inbox' ? inboxUnread : t.key === 'chat' ? supportUnread : 0;
          return (
            <button
              key={t.key}
              type="button"
              className="msh-tab"
              data-on={on ? 'true' : undefined}
              aria-current={on ? 'page' : undefined}
              aria-label={badge > 0 ? `${t.label}, ${badge} unread` : t.label}
              data-tour={t.key === 'chat' ? 'chat-tab' : undefined}
              onClick={() => selectTab(t.key)}
            >
              <span className="msh-tab-ic">
                {on ? t.filled : t.outline}
                {badge > 0 && (
                  <span className="msh-badge" aria-hidden>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className="msh-tab-lb">{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );

  // Work | Discover pill badge mirrors yubo's "Near you 24"
  const surfaceDiscoverBadge = discoverUnread;

  return (
    <div className="msh" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* ── Work | Discover switcher (yubo-style pill) ───────────────────── */}
      <div className="msh-surface-switch-wrap">
        <div className="msh-surface-switch" role="tablist" aria-label="Work or Discover">
          <button
            type="button"
            role="tab"
            aria-selected={surface === 'work'}
            data-on={surface === 'work' ? 'true' : undefined}
            onClick={() => setSurface('work')}
          >
            Work
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={surface === 'discover'}
            data-on={surface === 'discover' ? 'true' : undefined}
            onClick={() => setSurface('discover')}
          >
            Discover
            {surfaceDiscoverBadge > 0 && <em>{surfaceDiscoverBadge > 99 ? '99+' : surfaceDiscoverBadge}</em>}
          </button>
        </div>
      </div>

      {surface === 'discover' ? (
        <div className="msh-sheet" data-flush="true" style={{ background: '#F5F5F6' }}>
          <TalentShell
            channels={channels}
            dms={dms}
            meId={user?.id}
            supportChannelId={supportChannelId}
            supportUnread={supportUnread}
            onOpenChannel={(id, kind, title) => openConversation(id, kind, title)}
          />
        </div>
      ) : (
        <>
          {carbonHeader && (
            <header className="msh-header">
              {tab === 'chat' ? (
                <>
                  <div className="msh-header-row">
                    <h1 className="msh-chat-title">Chat</h1>
                    <button type="button" className="msh-hbtn" aria-label="New message" onClick={onNewDm}>
                      {MIcon.compose}
                    </button>
                  </div>
                  {chatSearchOpen ? (
                    <label className="msh-search-field">
                      <span>{MIcon.search}</span>
                      <input
                        value={chatQuery}
                        onChange={(e) => setChatQuery(e.target.value)}
                        placeholder="Search channels, DMs…"
                        autoFocus
                      />
                      <button
                        type="button"
                        aria-label="Close search"
                        onClick={() => { setChatSearchOpen(false); setChatQuery(''); }}
                      >
                        {MIcon.close}
                      </button>
                    </label>
                  ) : (
                    <button type="button" className="msh-search-pill" onClick={() => setChatSearchOpen(true)}>
                      {MIcon.search}
                      <span>Search channels, DMs…</span>
                    </button>
                  )}
                </>
              ) : (
                <div className="msh-header-row">
                  <div className="msh-logo" aria-hidden>S</div>
                  <div className="msh-wordmark">
                    <b>SquadHub</b>
                    <span>powered by UpSquad</span>
                  </div>
                  <button type="button" className="msh-hbtn" aria-label="Search" onClick={onOpenSearch}>
                    {MIcon.search}
                  </button>
                  <button
                    type="button"
                    className="msh-hbtn"
                    style={{ background: 'transparent', padding: 0 }}
                    aria-label="Account"
                    onClick={() => setDrawerOpen(true)}
                  >
                    <MAvatar name={user?.display_name || user?.email} url={user?.avatar_url} size={34} presence />
                  </button>
                </div>
              )}
            </header>
          )}

          <div className="msh-sheet" data-flush={!carbonHeader ? 'true' : undefined}>
            {showAppBar && (
              <div className="msh-appbar">
                <button type="button" className="msh-appbar-btn" aria-label="Back" onClick={goBack}>
                  {MIcon.back}
                </button>
                {!section?.bare && <h1 className="msh-appbar-title">{title}</h1>}
                {section?.bare && <span style={{ flex: 1 }} />}
              </div>
            )}

            {banner}

            {settingsOpen ? (
              <div className="msh-scroll">
                <MobileSettings />
              </div>
            ) : onSection || tab === 'inbox' ? (
              <div className="msh-pane">{renderPane()}</div>
            ) : (
              <div className="msh-scroll">
                {tab === 'home' ? (
                  isClient ? (
                    <MobileHome workspaceId={workspaceId} onOpen={openTarget} onCreateIn={createIn} />
                  ) : (
                    <MobilePartnerHome
                      workspaceId={workspaceId}
                      onOpen={openTarget}
                      onCreateIn={createIn}
                      onOpenFavorite={openPartnerFavorite}
                    />
                  )
                ) : tab === 'chat' ? (
                  <MobileChat
                    channels={channels}
                    dms={dms}
                    meId={user?.id}
                    supportChannelId={supportChannelId}
                    supportUnread={supportUnread}
                    query={chatQuery}
                    onOpenChannel={(id, t) => openConversation(id, 'channel', t)}
                    onOpenDm={(id, t) => openConversation(id, 'dm', t)}
                  />
                ) : (
                  <MobileMore
                    onOpen={openMore}
                    onOpenAccount={() => setDrawerOpen(true)}
                    onLogout={() => {
                      usePMStore.getState().reset();
                      onLogout();
                    }}
                  />
                )}
              </div>
            )}

            {showFab && (
              <button
                type="button"
                className="msh-fab"
                aria-label="New task"
                data-tour={onSection ? undefined : 'fab'}
                onClick={() => setCreating({ preset: fabTarget })}
              >
                {MIcon.plus}
              </button>
            )}
          </div>

          {tabBar}
        </>
      )}

      {floating && <div className="msh-floating">{floating}</div>}

      {creating && (
        <MobileCreateSheet
          workspaceId={workspaceId}
          preset={creating.preset}
          onClose={() => setCreating(null)}
        />
      )}

      {/* Only on the Home tab, where the tour anchors are on screen, and never
          over the create sheet. */}
      {tourOpen && !onSection && tab === 'home' && !creating && (
        <MobileTour
          userId={user?.id}
          audience={isClient ? 'client' : isPartner ? 'partner' : 'internal'}
          onDone={() => setTourOpen(false)}
        />
      )}

      {drawerOpen && (
        <AccountDrawer
          user={user}
          onClose={() => setDrawerOpen(false)}
          onOpenResources={() => {
            setDrawerOpen(false);
            setTab('more');
            setActiveSection('learning');
            openSection('Resources');
          }}
          onOpenSettings={() => {
            setDrawerOpen(false);
            setTab('more');
            openSection('Settings');
          }}
          onLogout={() => {
            setDrawerOpen(false);
            usePMStore.getState().reset();
            onLogout();
          }}
        />
      )}
    </div>
  );
}

/** Left slide-in account panel — the Android app's GlassDrawer. */
function AccountDrawer({
  user,
  onClose,
  onOpenResources,
  onOpenSettings,
  onLogout,
}: {
  user: User | null;
  onClose: () => void;
  onOpenResources: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {

  // Escape closes, and the page behind must not scroll while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="msh-scrim" onClick={onClose} aria-hidden />
      <aside className="msh-drawer" role="dialog" aria-label="Account">
        <div className="msh-drawer-head">
          <MAvatar name={user?.display_name || user?.email} url={user?.avatar_url} size={48} presence />
          <div className="who">
            <b>{user?.display_name || 'Me'}</b>
            <span>{user?.email}</span>
          </div>
        </div>

        <div className="msh-drawer-body">
          <MRow icon={MIcon.profile} title="Profile" onClick={onClose} />
          <MRow
            icon={MIcon.bell}
            title="Notifications"
            subtitle="Manage browser alerts in your browser settings"
            onClick={onClose}
          />
          <MRow icon={MIcon.resources} title="Resources" onClick={onOpenResources} />
          <MRow icon={MIcon.settings} title="Settings" onClick={onOpenSettings} />
          <MRow icon={MIcon.help} title="Help & feedback" onClick={onOpenResources} />
        </div>

        <div className="msh-drawer-foot">
          <MRow icon={MIcon.logout} title="Log out" danger onClick={onLogout} trailing={<span />} />
        </div>
      </aside>
    </>
  );
}
