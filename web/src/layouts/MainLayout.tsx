import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

const ADMIN_APP_URL = process.env.NEXT_PUBLIC_ADMIN_URL || (process.env.NODE_ENV === 'production' ? '/admin' : 'http://localhost:3001');
import { useWorkspaceStore, type ChatKind } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import { usePMStore } from '../stores/pmStore';
import { loadViewPreferences } from '../stores/viewPreferencesSync';
import type { Workspace, Channel } from '@squadhub/shared';
import { connectSocket, disconnectSocket, getSocket } from '../services/socket';
import { usePresenceStore } from '../stores/presenceStore';
import ChatPanel from '../views/app/chat/ChatPanel';
import CreateChannelModal from '../views/app/chat/CreateChannelModal';
import GlobalCreateTaskModal from '../views/app/pm/GlobalCreateTaskModal';
import type { SavedDraft } from '../stores/draftTaskStore';
import ToastContainer from '../components/Toast';
import { useWorkBlockNotifier } from '../hooks/useWorkBlockNotifier';
import DraftTasksWidget from '../components/DraftTasksWidget';
import ListPage from '../views/app/pm/ListPage';
import FolderPage from '../views/app/pm/FolderPage';
import SpacePage from '../views/app/pm/SpacePage';
import HomeSidebar from '../views/app/HomeSidebar';
import SearchPalette from '../views/app/SearchPalette';
import SettingsSlider from '../components/SettingsSlider';
import CheckInWidget from '../views/app/checkin/CheckInWidget';
import CheckInsPage from '../views/app/check-ins/CheckInsPage';
import CandidatesPage from '../views/app/candidates/CandidatesPage';
import MeetingsView from '../views/app/meetings/MeetingsView';
import GlobalMeetingPanel from '../views/app/meetings/GlobalMeetingPanel';
import NotesShell from '../views/app/notes/NotesShell';
import { useHasMiniApp } from '../hooks/useMiniApps';
import TimeManagementPage from '../views/app/time-management/TimeManagementPage';
import SalesLeadsPage from '../views/app/sales/SalesLeadsPage';
import ThemeToggle from '../components/ThemeToggle';
import RailTimer from './RailTimer';
import ActiveTimer from '../components/ActiveTimer';
import TimeSheetPanel from '../components/TimeSheetPanel';
import ClientDashboard from '../views/app/client/ClientDashboard';
import PartnerCashBook from '../views/app/partner/PartnerCashBook';
import PartnerOpportunities from '../views/app/partner/PartnerOpportunities';
import ClientCashBook from '../views/app/client/ClientCashBook';
import ClientPublishedCards from '../views/app/client/ClientPublishedCards';
import ClientDesignDashboard from '../views/app/pm/client-design/ClientDesignDashboard';
import Home from '../views/app/home/Home';
import GlobalTaskDetailPanel from '../views/app/home/GlobalTaskDetailPanel';
import GlobalTaskPeekPanel from '../views/app/home/GlobalTaskPeekPanel';
import EmergencyBanner from '../views/app/pm/EmergencyBanner';
import InboxView from '../views/app/InboxView';
import InboxSlider from '../components/InboxSlider';
import MyTasksView from '../views/app/MyTasksView';
import DayPlannerView from '../views/app/DayPlannerView';
import CalendarView from '../views/app/calendar/CalendarView';
import RoutinesView from '../views/app/RoutinesView';
import LearningShell from '../views/app/learning/LearningShell';
import ClipsView from '../views/app/clips/ClipsView';
import AppsSidebar from '../views/app/apps/AppsSidebar';
import { launchApp, type AppDef } from '../config/apps';
import { useUserType, useIsPartner } from '../hooks/useUserType';
import { useNavHistory } from '../hooks/useNavHistory';
import { useUnreadCount } from '../hooks/useUnreadCount';
import { useNotificationFreshness } from '../hooks/useNotificationFreshness';
import { useBrowserNotifications } from '../hooks/useBrowserNotifications';
import BrowserNotificationsToggle from '../components/BrowserNotificationsToggle';
import { useIsMobile } from '../hooks/useIsMobile';
import FeatureTipOverlay from '../components/FeatureTipOverlay';
import { usePendingTips } from '../hooks/usePendingTips';
import { featureTipStore } from '../stores/featureTipStore';
import TabBar from '../components/TabBar';
import { useTabsStore } from '../stores/tabsStore';
import { canonicalKey, buildHomeSnapshot, type TabSnapshot } from '../lib/tabSnapshots';

// ---- Types ----
export type ActiveSection = 'home' | 'cal' | 'docs' | 'teams' | 'apps' | 'learning' | 'more';
export type HomeView = 'hub' | 'chat' | 'tasks' | 'inbox' | 'my-tasks' | 'checkin' | 'checkin-partners' | 'check-ins' | 'candidates' | 'time-management' | 'sales-leads' | 'cashbook' | 'opportunities' | 'published-cards' | 'day-planner' | 'routines' | 'clips' | 'meetings';

// One entry in the in-app navigation history: everything needed to bring the
// user back to a view. Views switch via local state rather than URLs, so the
// browser's history can't drive the sidebar back/forward buttons.
type NavSnapshot = {
  section: ActiveSection;
  homeView: HomeView;
  channelId: string | null;
  channelKind: ChatKind;
  spaceId: string | null;
  listId: string | null;
  folderId: string | null;
  spacePageId: string | null;
  designFolderId: string | null;
};

// ---- Rail icons — soft-solid set (filled glyphs, 18×18) -------------------
// Confident filled silhouettes; interior detail (envelope flap, checkmark,
// fold, header, hourglass) is *cut* back out using stroke="var(--ic-cut)".
// `--ic-cut` is driven by the rail CSS to match whatever sits behind the icon
// — the rail bg when resting, the hover wash on hover, the pill when active —
// so the cut always reads as clean negative space. fill = currentColor, so
// the glyph is muted ink at rest and full ink (in the pill) when active.
const ICON = {
  home: (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M11.05 4.05a1.45 1.45 0 0 1 1.9 0l6.4 5.34c.32.27.5.66.5 1.08v8.05A1.7 1.7 0 0 1 18.15 20.2H15.5v-4.55a3.5 3.5 0 0 0-7 0v4.55H5.85A1.7 1.7 0 0 1 4.15 18.5v-8.03c0-.42.18-.81.5-1.08z" />
    </svg>
  ),
  inbox: (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M5.8 4.4h12.4a2 2 0 0 1 2 2v11.2a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2V6.4a2 2 0 0 1 2-2z" />
      <path d="M4.6 7.4l6.6 4.7a1.4 1.4 0 0 0 1.6 0l6.6-4.7" fill="none" stroke="var(--ic-cut)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  tasks: (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M8.4 3.8h7.2a4.6 4.6 0 0 1 4.6 4.6v7.2a4.6 4.6 0 0 1-4.6 4.6H8.4a4.6 4.6 0 0 1-4.6-4.6V8.4a4.6 4.6 0 0 1 4.6-4.6z" />
      <path d="m8.4 12.1 2.5 2.5 4.7-5.2" fill="none" stroke="var(--ic-cut)" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  docs: (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M7.4 4.2h5.74a1 1 0 0 1 .71.3l4.06 4.06a1 1 0 0 1 .29.7v9.34A2.2 2.2 0 0 1 16 20.8H7.4A2.2 2.2 0 0 1 5.2 18.6V6.4A2.2 2.2 0 0 1 7.4 4.2z" />
      <path d="M13.3 4.5v3.2a1.4 1.4 0 0 0 1.4 1.4h3.2" fill="none" stroke="var(--ic-cut)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.7 13.4h6.6M8.7 16.4h4.4" fill="none" stroke="var(--ic-cut)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  cal: (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="4" y="5.4" width="16" height="14.6" rx="3" />
      <path d="M8.5 3.3v3.2M15.5 3.3v3.2" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
      <path d="M4.4 9.7h15.2" fill="none" stroke="var(--ic-cut)" strokeWidth={1.6} strokeLinecap="round" />
      <g fill="var(--ic-cut)">
        <circle cx="8.7" cy="13.7" r="1" /><circle cx="12" cy="13.7" r="1" /><circle cx="15.3" cy="13.7" r="1" />
        <circle cx="8.7" cy="16.8" r="1" /><circle cx="12" cy="16.8" r="1" />
      </g>
    </svg>
  ),
  apps: (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="6" cy="6" r="1.7" /><circle cx="12" cy="6" r="1.7" /><circle cx="18" cy="6" r="1.7" />
      <circle cx="6" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18" cy="12" r="1.7" />
      <circle cx="6" cy="18" r="1.7" /><circle cx="12" cy="18" r="1.7" /><circle cx="18" cy="18" r="1.7" />
    </svg>
  ),
  learning: (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M12 5.4 2.5 9.3 12 13.2l9.5-3.9z" />
      <path d="M6.9 11.7v2.9c0 1.2 2.28 2.2 5.1 2.2s5.1-1 5.1-2.2v-2.9" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21.5 9.6v3.7" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <circle cx="21.5" cy="14" r="1.05" />
    </svg>
  ),
  timesheet: (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M8 5 16 5 12 11.2 16 19 8 19 12 11.2Z" />
      <path d="M6.6 3.9h10.8M6.6 20.1h10.8" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
    </svg>
  ),
  more: (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18.5" cy="12" r="1.5" />
    </svg>
  ),
} as const;

const SECTION_TITLES: Record<ActiveSection, string> = {
  home: 'My Home',
  cal: 'Calendar',
  docs: 'Documents',
  teams: 'Teams',
  apps: 'Apps',
  learning: 'Resources',
  more: 'More',
};

// Single rail button — used in both nav groups
function RailBtn({
  icon,
  label,
  active,
  badge,
  badgeAlert = false,
  badgePulse = false,
  anchorKey,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  /** Render the badge red (a notification arrived recently). */
  badgeAlert?: boolean;
  /** Play the expanding pulse ring (a notification just arrived). */
  badgePulse?: boolean;
  /** Stable key so a Feature Tip coachmark can anchor to this rail button. */
  anchorKey?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      data-tip-anchor={anchorKey}
      data-active={active}
      className="sh-rail-item"
    >
      <span className="sh-rail-ic">
        {icon}
        {badge != null && badge > 0 && (
          <span className="absolute top-[1px] right-[1px] grid place-items-center">
            {badgeAlert && badgePulse && (
              <span
                aria-hidden
                className="sh-badge-ping absolute inset-0 rounded-full"
                style={{ background: 'var(--sh-badge-alert)' }}
              />
            )}
            <span
              className={`relative grid min-w-[14px] h-[14px] place-items-center rounded-full text-[9px] font-semibold px-[3px] leading-none ${
                badgeAlert ? 'text-white' : 'text-[var(--sidebar)]'
              }`}
              style={{ background: badgeAlert ? 'var(--sh-badge-alert)' : 'var(--sh-ink)' }}
            >
              {badge}
            </span>
          </span>
        )}
      </span>
      <span className="sh-rail-lb">{label}</span>
    </button>
  );
}

export default function MainLayout() {
  const { currentWorkspace, activeChannelId, activeChannelKind, dmConversations, setWorkspace, setChannels, setActiveChannel } = useWorkspaceStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const pmReset = usePMStore((s) => s.reset);
  const activeSpaceId = usePMStore((s) => s.activeSpaceId);
  const activeListId = usePMStore((s) => s.activeListId);
  const activeFolderId = usePMStore((s) => s.activeFolderId);
  const activeSpacePageId = usePMStore((s) => s.activeSpacePageId);
  const activeDesignFolderId = usePMStore((s) => s.activeDesignFolderId);
  // A list/board view shows its own floating "New task" button; when it does,
  // the global top-bar "+" hides so the two create affordances don't overlap.
  const newTaskFabVisible = usePMStore((s) => s.newTaskFabVisible);
  // The tab strip only shows with ≥2 tabs; the top-right "+" sits below it when so.
  const tabStripVisible = useTabsStore((s) => s.tabs.length > 1);
  // The full tab list + active id drive the multi-pane content area: every open
  // tab is rendered from its OWN snapshot and kept mounted, so switching tabs
  // preserves each one's state (scroll, inputs, media) instead of remounting.
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  // Tabs are lazy-mounted: a tab's pane is created the first time it becomes
  // active, then kept alive until the tab is closed. This set tracks which tabs
  // have been opened (so we don't eagerly mount every persisted tab on load).
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(() => {
    const id = useTabsStore.getState().activeTabId;
    return new Set(id ? [id] : []);
  });
  useEffect(() => {
    setMountedTabIds((prev) => {
      const valid = new Set(tabs.map((t) => t.id));
      const next = new Set<string>();
      for (const id of prev) if (valid.has(id)) next.add(id); // drop closed tabs
      if (activeTabId && valid.has(activeTabId)) next.add(activeTabId);
      if (next.size === prev.size) {
        let same = true;
        for (const id of next) if (!prev.has(id)) { same = false; break; }
        if (same) return prev; // no change — avoid a needless re-render
      }
      return next;
    });
  }, [tabs, activeTabId]);
  const userType = useUserType();
  const isPartner = useIsPartner();
  // SquadNotes is a gated mini app — the Documents rail icon only shows for
  // granted users (admins are granted via Access Control, like Check-Ins).
  const hasNotes = useHasMiniApp('squad-notes');
  // Restore the last view from the persisted PM store (MainLayout only mounts
  // after pmStore hydration — see useHasHydrated — so getState() is the saved
  // value, not the default). This keeps a full-page refresh on the view the
  // user was on instead of bouncing to My Home / a stale list.
  const [activeSection, setActiveSection] = useState<ActiveSection>(
    () => (usePMStore.getState().lastActiveSection as ActiveSection) || 'home',
  );
  const [homeView, setHomeView] = useState<HomeView>(
    () => (usePMStore.getState().lastHomeView as HomeView) || 'hub',
  );
  // Live presence set for the chat header dot (hooks can't run inside the
  // header IIFE below, so subscribe here).
  const onlineUserIds = usePresenceStore((s) => s.onlineUserIds);
  const { data: unreadData } = useUnreadCount();
  const unreadCount = unreadData ?? 0;
  // Drive the notification badge's red/pulse states from changes in the count.
  const { alert: inboxAlert, pulse: inboxPulse } = useNotificationFreshness(unreadData);
  useBrowserNotifications(currentWorkspace?.id);
  // Schedule in-app toasts for upcoming work-block windows today.
  useWorkBlockNotifier();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isMobile = useIsMobile();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [resumingDraft, setResumingDraft] = useState<SavedDraft | null>(null);
  const [timesheetOpen, setTimesheetOpen] = useState(false);
  const [timesheetAnchor, setTimesheetAnchor] = useState<DOMRect | null>(null);
  const [inboxSliderOpen, setInboxSliderOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [profileOpen]);

  useEffect(() => { loadViewPreferences(); }, []);

  // Lock body scroll while the mobile drawer is open so the underlying
  // page doesn't move behind the overlay.
  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileDrawerOpen]);

  // Global keyboard shortcuts:
  //   ⌘K / Ctrl+K -> open workspace search palette
  //   ⌘N / Ctrl+N -> open the New Task creation panel
  //   /           -> focus the view's top-right search input (when not already typing)
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if ((target as HTMLElement).isContentEditable) return true;
      return false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      // ⌘N (Mac) / Ctrl+N (Windows/Linux) opens the New Task panel. Ignore when
      // a chord modifier is also held (e.g. ⌘⇧N = incognito) so we don't hijack
      // those. Note: most browsers reserve ⌘N/Ctrl+N for "new window" and won't
      // let the page cancel it — this fires in standalone/PWA & desktop webview
      // contexts where the browser doesn't grab the combo first.
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === 'n' || e.key === 'N')
      ) {
        e.preventDefault();
        setShowCreateTaskModal(true);
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditableTarget(e.target)) {
        const input = document.querySelector<HTMLInputElement>('[data-view-search="true"]');
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // True for the commit produced by a nav-history restore: the auto-switch
  // effects below must not fight the exact view being restored (e.g. forcing
  // 'tasks' when the snapshot being applied is the inbox with a list still
  // selected). Cleared by an effect declared after the nav-history wiring.
  // Initialized true so the same effects also stand down on the very first
  // mount — otherwise a persisted activeListId (etc.) would auto-switch to
  // 'tasks' and clobber the homeView we just restored from the PM store.
  const navRestoringRef = useRef(true);

  // Auto-switch to the home/tasks view when a list is selected. The section is
  // forced to 'home' too so selecting from a non-home surface (e.g. the global
  // task panel's breadcrumb opened over Calendar/Apps) actually lands on the list.
  useEffect(() => {
    if (navRestoringRef.current) return;
    if (activeListId) { setActiveSection('home'); setHomeView('tasks'); setMobileDrawerOpen(false); }
  }, [activeListId]);

  // Auto-switch to the home/tasks view when a folder is selected
  useEffect(() => {
    if (navRestoringRef.current) return;
    if (activeFolderId) { setActiveSection('home'); setHomeView('tasks'); setMobileDrawerOpen(false); }
  }, [activeFolderId]);

  // Auto-switch to the home/tasks view when a space is opened (space page)
  useEffect(() => {
    if (navRestoringRef.current) return;
    if (activeSpacePageId) { setActiveSection('home'); setHomeView('tasks'); setMobileDrawerOpen(false); }
  }, [activeSpacePageId]);

  // Auto-switch to tasks view when a client opens a design folder
  useEffect(() => {
    if (navRestoringRef.current) return;
    if (activeDesignFolderId) { setHomeView('tasks'); setMobileDrawerOpen(false); }
  }, [activeDesignFolderId]);

  // Persist the current view so a full-page refresh restores it (paired with
  // the lazy initial state above and the first-mount guard on navRestoringRef).
  useEffect(() => {
    usePMStore.getState().setLastView(activeSection, homeView);
  }, [activeSection, homeView]);

  // Fetch workspaces
  const { data: workspacesRes, isLoading: workspacesLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces').then((r) => r.data),
  });

  const workspaces: (Workspace & { my_role?: string })[] = useMemo(() => workspacesRes?.data || [], [workspacesRes]);

  // Auto-select first workspace on first load, and re-sync whenever the
  // React Query refetch surfaces a changed my_role for the active workspace
  // (e.g. an admin edited the role mid-session). Without this, the Zustand
  // store freezes on its initial value and users have to hard-refresh to
  // pick up role changes.
  useEffect(() => {
    if (workspaces.length === 0) return;
    const next = currentWorkspace
      ? (workspaces.find((w) => w.id === currentWorkspace.id) ?? workspaces[0])
      : workspaces[0];
    if (
      !currentWorkspace ||
      currentWorkspace.id !== next.id ||
      currentWorkspace.my_role !== next.my_role
    ) {
      setWorkspace(next);
    }
  }, [workspaces, currentWorkspace, setWorkspace]);

  // Fetch channels for current workspace
  const { data: channelsRes } = useQuery({
    queryKey: ['channels', currentWorkspace?.id],
    queryFn: () => api.get(`/channels?workspace_id=${currentWorkspace!.id}`).then((r) => r.data),
    enabled: !!currentWorkspace,
  });

  const channels: Channel[] = useMemo(() => channelsRes?.data || [], [channelsRes]);

  // Update store when channels change
  useEffect(() => {
    if (channels.length > 0) {
      setChannels(channels);
      if (!activeChannelId) {
        setActiveChannel(channels[0].id);
      }
    }
  }, [channels, activeChannelId, setChannels, setActiveChannel]);

  // Connect socket when workspace loads
  useEffect(() => {
    if (currentWorkspace) {
      const socket = connectSocket();
      socket.emit('join_workspace', currentWorkspace.id);
      return () => { disconnectSocket(); };
    }
  }, [currentWorkspace]);

  // ---- Feature Tips (admin-triggered coachmarks / announcements) ----
  const queryClient = useQueryClient();
  // Guide a tip's target_view by driving the same nav state apps use.
  const navigateToView = (v: HomeView) => {
    setActiveSection('home');
    setHomeView(v);
    setMobileDrawerOpen(false);
  };
  // A tip step targets either a HomeView or the special 'apps' module (the rail's
  // grid icon, whose side menu hosts the star/pin control).
  const navigateToTipTarget = (target: string) => {
    if (target === 'apps') {
      setActiveSection('apps');
      setMobileDrawerOpen(false);
      return;
    }
    navigateToView(target as HomeView);
  };
  const { data: pendingTips } = usePendingTips(!!currentWorkspace);
  useEffect(() => {
    featureTipStore.setQueue(pendingTips ?? []);
  }, [pendingTips]);
  // "Show me" / tour auto-nav → the overlay asks, we navigate.
  useEffect(() => featureTipStore.subscribeNav((view) => navigateToTipTarget(view)), []);
  // Re-check pending tips when the user changes screens (so a coachmark anchored
  // to a freshly-entered view shows without waiting for the next poll).
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['feature-tips', 'pending'] });
  }, [activeSection, homeView, queryClient]);
  // A trigger broadcasts this content-free event — re-fetch immediately.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onChanged = () => queryClient.invalidateQueries({ queryKey: ['feature-tips', 'pending'] });
    socket.on('feature_tips_changed', onChanged);
    return () => { socket.off('feature_tips_changed', onChanged); };
  }, [currentWorkspace, queryClient]);

  const openInboxNotification = (notificationId: string) => {
    setActiveSection('home');
    setHomeView('inbox');
    setInboxSliderOpen(false);
    window.__pendingInboxNotificationId = notificationId;
  };

  // Deep link handler — desktop companion / browser notification clicks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openTask = params.get('open_task');
    const openChannel = params.get('open_channel');
    const openInbox = params.get('open_inbox');
    if (openInbox) {
      openInboxNotification(openInbox);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (openTask) {
      usePMStore.getState().setActiveTask(openTask);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (openChannel) {
      setActiveChannel(openChannel);
      setHomeView('chat');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [setActiveChannel]);

  useEffect(() => {
    const onOpenInbox = (e: Event) => {
      const id = (e as CustomEvent<{ notificationId: string }>).detail.notificationId;
      if (id) openInboxNotification(id);
    };
    window.addEventListener('squadhub:open-inbox', onOpenInbox);
    return () => window.removeEventListener('squadhub:open-inbox', onOpenInbox);
  }, []);

  // Handlers for HomeSidebar
  const handleSelectChannel = (channelId: string) => {
    setActiveChannel(channelId, 'channel');
    setHomeView('chat');
    setMobileDrawerOpen(false);
  };
  const handleSelectDm = (dmId: string) => {
    setActiveChannel(dmId, 'dm');
    setHomeView('chat');
    setMobileDrawerOpen(false);
  };

  const handleOpenSpaces = () => {
    setHomeView('tasks');
  };

  // Launch an app from the home sidebar's pinned-apps section — switches to the
  // home section and opens the app's view. Link-out apps (SquadBooks) hand off
  // with an SSO token instead.
  const handleLaunchApp = (app: AppDef) => {
    void launchApp(app, {
      workspace: currentWorkspace,
      openView: (v) => {
        setActiveSection('home');
        setHomeView(v);
        setMobileDrawerOpen(false);
      },
    });
  };

  // Open an app from the Apps module's sidebar — stays in the Apps section so
  // the app list remains visible to switch between apps. Link-out apps hand off
  // with an SSO token and leave the current view untouched.
  const handleOpenAppInModule = (app: AppDef) => {
    void launchApp(app, {
      workspace: currentWorkspace,
      openView: (v) => {
        setHomeView(v);
        setMobileDrawerOpen(false);
      },
    });
  };

  // ---- In-app navigation history (sidebar back/forward buttons) ----
  // Page identity: which fields matter depends on the view, so background
  // changes (e.g. default channel auto-selecting while on a tasks view)
  // don't record entries.
  const navKey =
    activeSection !== 'home'
      ? `section:${activeSection}`
      : homeView === 'chat'
        ? `chat:${activeChannelKind}:${activeChannelId ?? ''}`
        : homeView === 'tasks'
          ? `tasks:${activeSpaceId ?? ''}:${activeFolderId ?? ''}:${activeListId ?? ''}:${activeSpacePageId ?? ''}:${activeDesignFolderId ?? ''}`
          : `home:${homeView}`;
  const navSnapshot = useMemo<NavSnapshot>(
    () => ({
      section: activeSection,
      homeView,
      channelId: activeChannelId,
      channelKind: activeChannelKind,
      spaceId: activeSpaceId,
      listId: activeListId,
      folderId: activeFolderId,
      spacePageId: activeSpacePageId,
      designFolderId: activeDesignFolderId,
    }),
    [activeSection, homeView, activeChannelId, activeChannelKind, activeSpaceId, activeListId, activeFolderId, activeSpacePageId, activeDesignFolderId],
  );

  // Apply a saved snapshot to the live view — shared by the sidebar back/forward
  // history and the top tab strip (both restore a NavSnapshot). Setters used here
  // are stable (useState/zustand actions), so this is safe to memoize.
  const applySnapshot = useCallback((s: NavSnapshot) => {
    setActiveSection(s.section);
    setHomeView(s.homeView);
    if (s.section === 'home' && s.homeView === 'chat') {
      setActiveChannel(s.channelId, s.channelKind);
    } else if (s.section === 'home' && s.homeView === 'tasks') {
      // Raw setState: the individual pm setters clear sibling selections,
      // which would fight the exact state being restored.
      usePMStore.setState({
        activeSpaceId: s.spaceId,
        activeListId: s.listId,
        activeFolderId: s.folderId,
        activeSpacePageId: s.spacePageId,
        activeDesignFolderId: s.designFolderId,
        contextListId: s.listId,
        selectedTasks: [],
      });
    }
    setMobileDrawerOpen(false);
  }, [setActiveChannel]);

  // Identity of the live view for the tab strip (mini-apps keyed per-app, unlike
  // navKey). Kept in refs so the once-mounted tab subscriber reads current values.
  const tabKey = useMemo(() => canonicalKey(navSnapshot), [navSnapshot]);
  const navSnapshotRef = useRef(navSnapshot);
  navSnapshotRef.current = navSnapshot;
  const liveKeyRef = useRef(tabKey);
  liveKeyRef.current = tabKey;

  // Live-mirror: keep the active tab in sync with the live view. Declared before
  // useNavHistory's recorder and the trailing navRestoringRef reset so it runs
  // with the guard still set during a restore (refresh-only, never create/focus).
  useEffect(() => {
    useTabsStore.getState().onNavigate(navSnapshot, tabKey, navRestoringRef.current);
  }, [navSnapshot, tabKey]);

  const nav = useNavHistory<NavSnapshot>({
    snapshot: navSnapshot,
    key: navKey,
    resetKey: currentWorkspace?.id,
    restoringRef: navRestoringRef,
    onRestore: applySnapshot,
  });
  // Declared after the auto-switch effects and the recorder inside
  // useNavHistory, so it runs last in the restore commit and closes the
  // window navRestoringRef opens.
  useEffect(() => {
    navRestoringRef.current = false;
  });

  // Restore a tab's snapshot into the live view when the active tab changes
  // (tab click, close, new-tab). The store fires this synchronously inside the
  // triggering click's call stack, so the navRestoringRef guard behaves exactly
  // like the back/forward restore above. Skipped when the live view already
  // matches (e.g. onNavigate just focused an existing tab) to avoid redundant work.
  useEffect(() => {
    return useTabsStore.subscribe((state, prev) => {
      if (state.activeTabId === prev.activeTabId) return;
      const tab = state.tabs.find((t) => t.id === state.activeTabId);
      if (!tab) return;
      if (canonicalKey(tab.snapshot) === liveKeyRef.current) return;
      navRestoringRef.current = true;
      applySnapshot(tab.snapshot);
    });
  }, [applySnapshot]);

  // Seed the tab strip on first load; reset it on a genuine workspace switch
  // (list/folder/channel ids are workspace-scoped — mirrors nav-history's reset).
  useEffect(() => {
    if (!currentWorkspace) return;
    const st = useTabsStore.getState();
    if (st.workspaceId != null && st.workspaceId !== currentWorkspace.id) {
      st.resetForWorkspace(currentWorkspace.id, buildHomeSnapshot('hub'));
    } else {
      st.ensureSeed(navSnapshotRef.current, currentWorkspace.id);
    }
  }, [currentWorkspace?.id]);

  // Loading state
  if (workspacesLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-surface">
        <p className="text-sm text-foreground-dim">Loading...</p>
      </div>
    );
  }

  // No workspaces
  if (!workspacesRes || workspaces.length === 0) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-surface">
        <div className="text-center">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-foreground">Welcome to SquadHub</h2>
          <p className="mt-2 text-sm text-foreground-muted">Your workspace is being set up. Please refresh in a moment.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-surface transition hover:opacity-80"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // The global top-bar "+" creates a SquadHub task. Hide it where the current
  // surface already owns the top-right create affordance, so it doesn't stack a
  // redundant button on top of theirs:
  //   • list/board views — their own floating "New task" FAB (newTaskFabVisible)
  //   • embedded standalone apps (Squad Clips, Daily Check-In, Time Management,
  //     Sales Leads) — each renders its own header/actions; the global "+" was
  //     overlapping e.g. Squad Clips' "New recording ▾" dropdown chevron.
  const EMBEDDED_APP_VIEWS: HomeView[] = ['clips', 'checkin', 'checkin-partners', 'check-ins', 'candidates', 'time-management', 'sales-leads'];
  // Day Planner gets the create button as a bottom-right floating FAB instead of
  // the top-right "+", which otherwise collides with the calendar's header.
  const onDayPlanner = activeSection === 'home' && homeView === 'day-planner';
  // Calendar owns its own header nav (prev/next + view switch) on the top-right,
  // so suppress the global "+" the same way Day Planner does. It's the dedicated
  // 'cal' rail section (full-width, no module sidebar).
  const onCalendar = activeSection === 'cal';
  const hideGlobalCreateBtn =
    newTaskFabVisible || activeSection === 'apps' || EMBEDDED_APP_VIEWS.includes(homeView) || onDayPlanner || onCalendar;

  // ---- Per-tab pane rendering ----------------------------------------------
  // Each open tab is rendered from its OWN snapshot rather than the single
  // global "live view", so every tab keeps its own mounted component tree (and
  // therefore its scroll position, in-progress input and media playback — e.g.
  // a Squad Clip resumes instead of restarting). Only the active tab is shown;
  // the rest are kept mounted but display:none. Navigation/mutations still flow
  // through the global stores, which always mirror the active tab.
  const renderChat = (snap: TabSnapshot) => {
    const channelId = snap.channelId;
    const kind = snap.channelKind;
    const isDm = kind === 'dm';
    const channel = channels.find((c) => c.id === channelId);
    const activeDm = isDm ? dmConversations.find((d) => d.id === channelId) : null;
    const meId = user?.id;
    const otherParticipants = (activeDm?.participants || []).filter((p) => p.id !== meId);
    const dmTitle = isDm
      ? (otherParticipants.length === 0
          ? 'Note to self'
          : otherParticipants.length === 1
            ? otherParticipants[0].display_name
            : `${otherParticipants[0].display_name} +${otherParticipants.length - 1}`)
      : null;
    const headerName = isDm ? dmTitle : channel?.name;
    const memberCount = isDm ? (activeDm?.participants?.length || 0) : null;
    // For a note-to-self DM there are no "others" — show the user's own avatar.
    const firstOther = otherParticipants[0] || activeDm?.participants?.[0];
    const dmOnline = !!firstOther && onlineUserIds.has(firstOther.id);
    const avatarGradient = (id: string) => {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
      return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 65% 45%))`;
    };
    return (
      // min-h-0 is load-bearing: without it this flex child's automatic
      // minimum is its content height, so a long conversation overflows
      // the viewport and clips the composer instead of scrolling.
      <div className="squadhub-chat flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
        {channelId && (
          <div className="sqc-header">
            <div className="sqc-header__title" title={isDm ? 'Conversation' : 'Channel details'}>
              {isDm ? (
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-[6px] text-[11px] font-bold text-white"
                  style={{ background: firstOther?.avatar_url ? undefined : avatarGradient(firstOther?.id || 'x') }}
                >
                  {firstOther?.avatar_url ? (
                    <img src={firstOther.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (firstOther?.display_name?.[0] || '?').toUpperCase()
                  )}
                </span>
              ) : (
                <span className="text-[18px] font-black leading-none text-[var(--sh-text-2)]">#</span>
              )}
              <span>{headerName}</span>
              {isDm && otherParticipants.length === 1 && (
                <span
                  className={`sqc-presence${dmOnline ? ' is-online' : ''}`}
                  title={dmOnline ? 'Active' : 'Away'}
                />
              )}
              <svg className="h-3.5 w-3.5 text-[var(--sh-text-2)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {!isDm && channel?.description && (
              <button type="button" className="sqc-header__topic" title="Set channel topic">
                {channel.description}
              </button>
            )}
            <div className="sqc-header__actions">
              {isDm && memberCount != null && memberCount > 0 && (
                <span className="sqc-pill" title={`${memberCount} ${memberCount === 1 ? 'member' : 'members'}`}>
                  <span className="sqc-pill__avatars">
                    {(activeDm?.participants || []).slice(0, 3).map((p) => (
                      <span
                        key={p.id}
                        style={{ background: p.avatar_url ? undefined : avatarGradient(p.id) }}
                        className="overflow-hidden"
                      >
                        {p.avatar_url ? (
                          <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          (p.display_name?.[0] || '?').toUpperCase()
                        )}
                      </span>
                    ))}
                  </span>
                  <span>{memberCount}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowChannelSettings(!showChannelSettings)}
                className={`sqc-pill ${showChannelSettings ? 'bg-[var(--sh-bg-hover)]' : ''}`}
                title="Settings"
              >
                <svg className="h-4 w-4 text-[var(--sh-text-2)]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zm0 6a.75.75 0 110-1.5.75.75 0 010 1.5zm0 6a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                </svg>
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
          {channelId ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <ChatPanel channelId={channelId} kind={kind} />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-foreground-dim">
              Select a channel to start chatting
            </div>
          )}
          {showChannelSettings && channelId && (() => {
            const ch = channels.find((c) => c.id === channelId);
            return ch ? (
              <SettingsSlider
                type="channel"
                id={ch.id}
                name={ch.name}
                description={ch.description}
                onClose={() => setShowChannelSettings(false)}
                onDeleted={() => {
                  setShowChannelSettings(false);
                  setActiveChannel(null);
                }}
              />
            ) : null;
          })()}
        </div>
      </div>
    );
  };

  const renderPane = (snap: TabSnapshot, active = true) => {
    const { section, homeView: hv } = snap;
    if (section === 'learning') return <LearningShell />;
    if (section === 'docs') return <NotesShell />;
    if (section === 'cal') return <CalendarView />;
    if (section === 'apps') {
      // Apps module — render the app opened from the Apps sidebar, or an empty
      // state. App views reuse the same components as the home section.
      if (hv === 'checkin') return <CheckInWidget title="Daily Check-In Teammates" context="teammates" />;
      if (hv === 'checkin-partners') return <CheckInWidget title="Daily Check-In Partners" context="partners" />;
      if (hv === 'check-ins') return <CheckInsPage />;
      if (hv === 'candidates') return <CandidatesPage />;
      if (hv === 'time-management') return <TimeManagementPage />;
      if (hv === 'sales-leads') return <SalesLeadsPage />;
      if (hv === 'clips') return <ClipsView />;
      if (hv === 'meetings') return <MeetingsView />;
      if (hv === 'cashbook' && isPartner) return <PartnerCashBook />;
      if (hv === 'cashbook' && (userType === 'client' || userType === 'client_staff')) return <ClientCashBook />;
      return (
        <div className="sh-view flex flex-1 flex-col items-center justify-center">
          <div className="mb-4 opacity-20 text-[var(--sh-ink-3)]">{ICON.apps}</div>
          <h3 className="serif text-[40px] text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', letterSpacing: '-0.01em' }}>Apps</h3>
          <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">Select an app from the list to open it here</p>
        </div>
      );
    }
    if (section !== 'home') {
      // teams / more — placeholder sections.
      return (
        <div className="sh-view flex flex-1 flex-col items-center justify-center">
          <div className="mb-4 opacity-20 text-[var(--sh-ink-3)]">{ICON[section as keyof typeof ICON]}</div>
          <h3 className="serif text-[40px] text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', letterSpacing: '-0.01em' }}>{SECTION_TITLES[section]}</h3>
          <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">Coming soon</p>
        </div>
      );
    }
    // Home section views.
    if (hv === 'inbox') return <InboxView setHomeView={setHomeView} />;
    if (hv === 'my-tasks') return <MyTasksView />;
    if (hv === 'day-planner') return <DayPlannerView />;
    if (hv === 'routines') return <RoutinesView />;
    if (hv === 'chat') return renderChat(snap);
    if (hv === 'tasks') {
      if (snap.designFolderId) return <ClientDesignDashboard folderId={snap.designFolderId} />;
      if (snap.folderId && !snap.listId) return <FolderPage folderId={snap.folderId} />;
      if (snap.spacePageId && !snap.listId && !snap.folderId) return <SpacePage spacePageId={snap.spacePageId} />;
      return <ListPage listId={snap.listId ?? undefined} spaceId={snap.spaceId ?? undefined} active={active} />;
    }
    if (hv === 'checkin') return <CheckInWidget title="Daily Check-In Teammates" context="teammates" />;
    if (hv === 'checkin-partners') return <CheckInWidget title="Daily Check-In Partners" context="partners" />;
    if (hv === 'check-ins') return <CheckInsPage />;
    if (hv === 'candidates') return <CandidatesPage />;
    if (hv === 'time-management') return <TimeManagementPage />;
    if (hv === 'sales-leads') return <SalesLeadsPage />;
    if (hv === 'clips') return <ClipsView />;
    if (hv === 'meetings') return <MeetingsView />;
    if (hv === 'hub' && (userType === 'client' || userType === 'client_staff')) return <ClientDashboard />;
    if (hv === 'cashbook' && isPartner) return <PartnerCashBook />;
    if (hv === 'cashbook' && (userType === 'client' || userType === 'client_staff')) return <ClientCashBook />;
    if (hv === 'published-cards' && (userType === 'client' || userType === 'client_staff')) return <ClientPublishedCards />;
    if (hv === 'opportunities' && isPartner) return <PartnerOpportunities />;
    return <Home onOpenInbox={() => { setActiveSection('home'); setHomeView('inbox'); }} />;
  };

  return (
    <div className="flex h-[100dvh] bg-[var(--sidebar)] text-foreground">
      {/* Mobile top bar — only renders below md breakpoint. */}
      <div className="fixed inset-x-0 top-0 z-[60] flex h-12 items-center justify-between border-b border-[var(--sh-hair)] bg-[var(--icon-bar)] px-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileDrawerOpen(true)}
          aria-label="Open menu"
          className="grid h-9 w-9 place-items-center rounded-[8px] text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)]"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-[8px] bg-[var(--sh-ink)] text-[var(--sidebar)]" style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', fontSize: 18, letterSpacing: '-0.02em' }}>S</div>
          <span className="text-[13px] font-medium text-[var(--sh-ink)] truncate max-w-[140px]">
            {activeSection === 'home' ? SECTION_TITLES.home : SECTION_TITLES[activeSection]}
          </span>
        </div>
        {/* Kept rendered (but hidden) when the current surface owns the create
            affordance, so the title stays centered in this justify-between bar. */}
        <button
          type="button"
          onClick={() => setShowCreateTaskModal(true)}
          aria-label="Create new task"
          data-tip-anchor="action.new-task"
          aria-hidden={hideGlobalCreateBtn}
          tabIndex={hideGlobalCreateBtn ? -1 : undefined}
          className={`grid h-9 w-9 place-items-center rounded-[8px] text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)] ${hideGlobalCreateBtn ? 'invisible pointer-events-none' : ''}`}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* Mobile drawer backdrop */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/40 md:hidden"
          onClick={() => setMobileDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer container — wraps icon rail + module sidebar. On desktop this
          is a static flex row; on mobile it slides in/out as an overlay. */}
      <aside
        className={`fixed inset-y-0 left-0 z-[81] flex transition-transform duration-200 ease-in-out md:static md:z-auto md:transition-none ${
          mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
      {/* Far-left monochrome rail — 64px wide, inset right shadow, light gray */}
      <div
        className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-[var(--sh-hair)] bg-[var(--icon-bar)] px-2 pt-[14px] pb-3 relative z-[3]"
        style={{ boxShadow: 'var(--sh-rail-inset)' }}
      >
        {/* Serif "S" logo */}
        <div
          className="mb-[14px] grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--sh-ink)] text-[var(--sidebar)]"
          style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', fontSize: 22, letterSpacing: '-0.02em', boxShadow: 'var(--sh-shadow-sm)' }}
          title="SquadHub"
        >
          S
        </div>

        {/* Main nav: Home / Inbox / Tasks / Docs / Cal / Apps */}
        <div className="flex w-full flex-col items-center gap-[2px]">
          <RailBtn
            icon={ICON.home}
            label="Home"
            anchorKey="rail.home"
            active={activeSection === 'home' && homeView === 'hub'}
            onClick={() => { setActiveSection('home'); setHomeView('hub'); }}
          />
          <RailBtn
            icon={ICON.inbox}
            label="Inbox"
            anchorKey="rail.inbox"
            badge={unreadCount > 0 ? unreadCount : undefined}
            badgeAlert={inboxAlert}
            badgePulse={inboxPulse}
            active={(activeSection === 'home' && homeView === 'inbox') || inboxSliderOpen}
            onClick={() => {
              // The rail always toggles the slide-over; the full inbox view is
              // reached through the Home sidebar's Inbox item (or deep links).
              if (activeSection === 'home' && homeView === 'inbox') return;
              setMobileDrawerOpen(false);
              setInboxSliderOpen((v) => !v);
            }}
          />
          <RailBtn
            icon={ICON.tasks}
            label="Tasks"
            anchorKey="rail.tasks"
            active={activeSection === 'home' && homeView === 'my-tasks'}
            onClick={() => { setActiveSection('home'); setHomeView('my-tasks'); }}
          />
          {hasNotes && (
            <RailBtn icon={ICON.docs} label="Docs" anchorKey="rail.docs" active={activeSection === 'docs'} onClick={() => setActiveSection('docs')} />
          )}
          <RailBtn icon={ICON.cal}  label="Cal"  anchorKey="rail.cal"  active={activeSection === 'cal'}  onClick={() => setActiveSection('cal')} />
          <RailBtn icon={ICON.apps} label="Apps" anchorKey="rail.apps" active={activeSection === 'apps'} onClick={() => setActiveSection('apps')} />
          <RailBtn icon={ICON.learning} label="Resources" anchorKey="rail.learning" active={activeSection === 'learning'} onClick={() => setActiveSection('learning')} />
          <button
            onClick={(e) => {
              setTimesheetAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
              setTimesheetOpen((v) => !v);
            }}
            title="Time sheet"
            data-tip-anchor="rail.timesheet"
            data-active={timesheetOpen}
            className="sh-rail-item"
          >
            <span className="sh-rail-ic">{ICON.timesheet}</span>
            <span className="sh-rail-lb">Timesheet</span>
          </button>
        </div>

        {/* Divider */}
        <div className="h-px w-7 bg-[var(--sh-hair-2)] my-2" />

        {/* Second nav: More */}
        <div className="flex w-full flex-col items-center gap-[2px]">
          <RailBtn icon={ICON.more}  label="More"    anchorKey="rail.more"    active={activeSection === 'more'}    onClick={() => setActiveSection('more')} />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Live timer chip — only while a Work/Break/No-work timer is running.
            Clicking it returns to My Home where the full controls live. */}
        <RailTimer
          onOpen={() => {
            setActiveSection('home');
            setHomeView('hub');
            setMobileDrawerOpen(false);
          }}
        />

        {/* Bottom group: theme + avatar with profile popover */}
        <div className="flex w-full flex-col items-center gap-[6px]">
          <div className="sh-rail-util">
            <ThemeToggle />
            <span className="sh-rail-lb">Theme</span>
          </div>
          <div className="sh-rail-util">
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen((v) => !v)}
              className="grid h-8 w-8 place-items-center rounded-full bg-[var(--sh-ink)] text-[var(--sidebar)] text-[11px] font-semibold relative cursor-pointer"
              style={{ border: '2px solid var(--icon-bar)' }}
              title={user?.display_name || user?.email || 'Me'}
            >
              {(user?.display_name || user?.email || 'ME').split(/[ @]/).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join('').slice(0, 2) || 'ME'}
              <span className="absolute -right-[2px] -bottom-[2px] h-[10px] w-[10px] rounded-full bg-[var(--icon-bar)]" style={{ border: '2px solid var(--sh-ink)' }} />
            </button>

            {profileOpen && (
              <div className="absolute bottom-0 left-[calc(100%+10px)] w-[220px] rounded-lg bg-[var(--surface)] border border-[var(--sh-hair)] shadow-lg z-50 overflow-hidden">
                <div className="px-3 py-3 border-b border-[var(--sh-hair)]">
                  <p className="text-[13px] font-medium text-[var(--foreground)] truncate">{user?.display_name || 'User'}</p>
                  <p className="text-[11px] text-[var(--foreground-dim)] truncate">{user?.email}</p>
                </div>
                <div className="py-1">
                  <BrowserNotificationsToggle onCloseMenu={() => setProfileOpen(false)} />
                  <a
                    href="/download-app"
                    className="flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--foreground)] hover:bg-[var(--sh-hair-3)] transition"
                    onClick={() => setProfileOpen(false)}
                  >
                    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.07 7.409A2.25 2.25 0 012 5.493V5.25" />
                    </svg>
                    Download Desktop App
                  </a>
                  <button
                    onClick={() => { logout(); pmReset(); setProfileOpen(false); }}
                    className="flex items-center gap-2 px-3 py-2 text-[13px] text-red-500 hover:bg-[var(--sh-hair-3)] transition w-full text-left"
                  >
                    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3h-9m9 0l-3-3m3 3l-3 3" />
                    </svg>
                    Log Out
                  </button>
                </div>
              </div>
            )}
          </div>
            <span className="sh-rail-lb">
              {(user?.display_name || user?.email || 'Me').split(/[ @]/)[0]}
            </span>
          </div>
        </div>
      </div>

      {/* Module sidebar — always visible, flat edges, drop shadow to the right */}
      {currentWorkspace && activeSection !== 'learning' && activeSection !== 'docs' && activeSection !== 'cal' && (
        <div
          className={`flex h-full shrink-0 flex-col overflow-hidden bg-[var(--sidebar)] border-r border-[var(--sh-hair)] relative z-[2] transition-[width] duration-200 ease-in-out ${
            sidebarOpen ? 'w-[280px]' : 'w-0'
          }`}
          style={{ boxShadow: 'var(--sh-sidebar-drop)' }}
        >
          {activeSection === 'apps' ? (
            <AppsSidebar
              activeView={homeView}
              onOpenApp={handleOpenAppInModule}
              canGoBack={nav.canGoBack}
              canGoForward={nav.canGoForward}
              onNavBack={nav.goBack}
              onNavForward={nav.goForward}
            />
          ) : (
            <HomeSidebar
              workspaceId={currentWorkspace.id}
              channels={channels}
              activeChannelId={activeChannelId}
              homeView={homeView}
              inboxAlert={inboxAlert}
              inboxPulse={inboxPulse}
              canGoBack={nav.canGoBack}
              canGoForward={nav.canGoForward}
              onNavBack={nav.goBack}
              onNavForward={nav.goForward}
              onChangeView={(v) => { setActiveSection('home'); setHomeView(v); setMobileDrawerOpen(false); }}
              onSelectChannel={handleSelectChannel}
              onSelectDm={handleSelectDm}
              onCreateChannel={() => setShowCreateChannel(true)}
              onOpenSpaces={handleOpenSpaces}
              onOpenSearch={() => setSearchOpen(true)}
              onOpenApps={() => { setActiveSection('apps'); setMobileDrawerOpen(false); }}
              onLaunchApp={handleLaunchApp}
            />
          )}
        </div>
      )}
      </aside>

      {/* Main content area */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-surface pt-12 md:pt-0">
        {/* Chrome-style tab strip (desktop only) — each tab is a saved view. */}
        <TabBar />
        {/* Universal "New task" button — visible on task surfaces. Hidden on
            mobile (the mobile top bar has its own "+"), and hidden wherever the
            surface owns the top-right create affordance — a list/board's floating
            "New task" FAB, or an embedded app's own header (see hideGlobalCreateBtn).
            Offset below the tab strip's height on desktop. */}
        {!hideGlobalCreateBtn && (
          <button
            type="button"
            onClick={() => setShowCreateTaskModal(true)}
            title="New task"
            aria-label="Create new task"
            data-tip-anchor="action.new-task"
            className={`absolute right-3 top-2 z-40 hidden h-8 w-8 place-items-center rounded-[9px] border border-transparent text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] transition md:grid ${tabStripVisible ? 'md:top-[44px]' : ''}`}
          >
            <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
        {/* Day Planner: the create button lives as a bottom-right floating FAB
            (same style as the list view's) instead of the top-right "+". */}
        {onDayPlanner && (
          <button
            type="button"
            onClick={() => setShowCreateTaskModal(true)}
            className="lv-newtask-fab"
            aria-label="New task"
            title="New task"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New task
          </button>
        )}
        <EmergencyBanner />
        <ActiveTimer />
        {/* Fallback for the brief window before the tab strip is seeded (a brand
            new user with empty persisted tabs): render the live view from global
            state so the content area is never blank. */}
        {tabs.length === 0 && (
          <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
            {renderPane(navSnapshot)}
          </div>
        )}
        {tabs
          .filter((t) => mountedTabIds.has(t.id) || t.id === activeTabId)
          .map((t) => {
            const isActive = t.id === activeTabId;
            // Inactive tabs stay mounted (display:none) so returning to them is
            // instant and their state survives. display:none is set inline because
            // an author `display:flex` class would otherwise beat the [hidden] UA rule.
            return (
              <div
                key={t.id}
                className="flex flex-1 flex-col min-h-0 overflow-hidden"
                style={isActive ? undefined : { display: 'none' }}
                aria-hidden={!isActive}
              >
                {renderPane(t.snapshot, isActive)}
              </div>
            );
          })}
      </div>

      {/* Inbox panel — floating feed opened by the rail's inbox button */}
      {inboxSliderOpen && (
        <InboxSlider onClose={() => setInboxSliderOpen(false)} />
      )}

      {/* Global task detail panel — opens from any view when activeTaskId is set */}
      <GlobalTaskDetailPanel />

      {/* Side-by-side peek — opens when a task is clicked inside another
          task's panel (e.g. work-block activity rows). Renders the full
          TaskDetailPanel on the left so the host panel on the right stays
          visible at the same time. Disabled on mobile — its CSS anchors at
          left:360px which goes off-screen, and the side-by-side mental model
          breaks below 768px. */}
      {!isMobile && <GlobalTaskPeekPanel />}

      {/* Time sheet panel — anchored to the rail button */}
      {timesheetOpen && (
        <TimeSheetPanel
          anchorRect={timesheetAnchor}
          onClose={() => setTimesheetOpen(false)}
        />
      )}

      {/* Create channel modal */}
      {showCreateChannel && currentWorkspace && (
        <CreateChannelModal
          workspaceId={currentWorkspace.id}
          onClose={() => setShowCreateChannel(false)}
        />
      )}

      {/* Universal create task modal — opens from the global + button */}
      {showCreateTaskModal && (
        <GlobalCreateTaskModal
          onClose={() => { setShowCreateTaskModal(false); setResumingDraft(null); }}
          resumeDraft={resumingDraft}
          // Only pre-fill list/space when the user is actually viewing a
          // list-context page; otherwise (Home/Inbox/My Tasks/Docs/etc.) the
          // persisted activeListId/contextListId would leak in as a stale default.
          inListContext={activeSection === 'home' && homeView === 'tasks'}
        />
      )}

      {/* Meeting creation slide-over — opened from anywhere via the store */}
      <GlobalMeetingPanel />

      {/* Floating draft tasks widget */}
      <DraftTasksWidget
        onResumeDraft={(saved) => {
          setResumingDraft(saved);
          setShowCreateTaskModal(true);
        }}
      />

      {/* Toast notifications */}
      <ToastContainer />

      {/* Admin-triggered Feature Tips (coachmarks / "what's new" cards) */}
      <FeatureTipOverlay />

      {/* Workspace search palette */}
      {searchOpen && currentWorkspace && (
        <SearchPalette
          workspaceId={currentWorkspace.id}
          onClose={() => setSearchOpen(false)}
          setHomeView={(v) => { setActiveSection('home'); setHomeView(v); }}
        />
      )}
    </div>
  );
}
