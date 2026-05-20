import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const ADMIN_APP_URL = process.env.NEXT_PUBLIC_ADMIN_URL || (process.env.NODE_ENV === 'production' ? '/admin' : 'http://localhost:3001');
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import { usePMStore } from '../stores/pmStore';
import { loadViewPreferences } from '../stores/viewPreferencesSync';
import type { Workspace, Channel, RoleHomeView } from '@squadhub/shared';
import { connectSocket, disconnectSocket } from '../services/socket';
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
import TimeManagementPage from '../views/app/time-management/TimeManagementPage';
import SalesLeadsPage from '../views/app/sales/SalesLeadsPage';
import ThemeToggle from '../components/ThemeToggle';
import ActiveTimer from '../components/ActiveTimer';
import TimeSheetPanel from '../components/TimeSheetPanel';
import ClientDashboard from '../views/app/client/ClientDashboard';
import PartnerDashboard from '../views/app/partner/PartnerDashboard';
import PartnerCashBook from '../views/app/partner/PartnerCashBook';
import PartnerOpportunities from '../views/app/partner/PartnerOpportunities';
import ClientCashBook from '../views/app/client/ClientCashBook';
import ClientPublishedCards from '../views/app/client/ClientPublishedCards';
import ClientDesignDashboard from '../views/app/pm/client-design/ClientDesignDashboard';
import MemberHome from '../views/app/home/MemberHome';
import UserHome from '../views/app/home/UserHome';
import GuestHome from '../views/app/home/GuestHome';
import DesignerHome from '../views/app/home/DesignerHome';
import VideoEditorHome from '../views/app/home/VideoEditorHome';
import AccountantHome from '../views/app/home/AccountantHome';
import GlobalTaskDetailPanel from '../views/app/home/GlobalTaskDetailPanel';
import GlobalTaskPeekPanel from '../views/app/home/GlobalTaskPeekPanel';
import EmergencyBanner from '../views/app/pm/EmergencyBanner';
import InboxView from '../views/app/InboxView';
import MyTasksView from '../views/app/MyTasksView';
import DayPlannerView from '../views/app/DayPlannerView';
import LearningShell from '../views/app/learning/LearningShell';
import { useUserType, useIsPartner } from '../hooks/useUserType';
import { useUnreadCount } from '../hooks/useUnreadCount';
import { useNotificationSocket } from '../hooks/useNotificationSocket';
import { useIsMobile } from '../hooks/useIsMobile';

// ---- Types ----
type ActiveSection = 'home' | 'cal' | 'docs' | 'teams' | 'apps' | 'clients' | 'learning' | 'more';
export type HomeView = 'hub' | 'chat' | 'tasks' | 'inbox' | 'my-tasks' | 'mentions' | 'later' | 'checkin' | 'checkin-partners' | 'time-management' | 'sales-leads' | 'cashbook' | 'opportunities' | 'published-cards' | 'day-planner';

// ---- Role Home lookup ----
// Picks which Home component to render based on the role's home_view.
// Each key ↔ a RoleHomeView value from shared/src/index.ts.
const HOME_BY_VIEW: Record<RoleHomeView, React.ComponentType<{ onOpenInbox: () => void }>> = {
  member: MemberHome,
  user: UserHome,
  guest: GuestHome,
  designer: DesignerHome,
  video_editor: VideoEditorHome,
  accountant: AccountantHome,
};

// Role-specific homes override the user_type dashboards (Partner/Client).
// The "vanilla" home_view values (member/user/guest) are the user_type defaults
// and defer to PartnerDashboard / ClientDashboard as before.
const ROLE_SPECIFIC_HOMES: RoleHomeView[] = ['designer', 'video_editor', 'accountant'];

// ---- Rail icons (stroke-1.6, 18x18) ----
const ICON = {
  home: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
    </svg>
  ),
  inbox: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 13V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" />
      <path d="M3 13h5l2 3h4l2-3h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  tasks: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  ),
  docs: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h6" />
    </svg>
  ),
  cal: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  apps: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  learning: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  timesheet: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  users: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0" />
      <circle cx="17" cy="7" r="3" />
      <path d="M22 18a5 5 0 0 0-7-4.6" />
    </svg>
  ),
  more: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  ),
} as const;

const SECTION_TITLES: Record<ActiveSection, string> = {
  home: 'My Home',
  cal: 'Calendar',
  docs: 'Documents',
  teams: 'Teams',
  apps: 'Apps',
  clients: 'Clients',
  learning: 'Learning',
  more: 'More',
};

// Single rail button — used in both nav groups
function RailBtn({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`relative grid h-10 w-10 place-items-center rounded-[9px] transition ${
        active
          ? 'border border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink)]'
          : 'border border-transparent text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
      }`}
      style={active ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
    >
      {icon}
      {badge != null && badge > 0 && (
        <span
          className="absolute top-[3px] right-[3px] grid min-w-[14px] h-[14px] place-items-center rounded-full bg-[var(--sh-ink)] text-[var(--sidebar)] text-[9px] font-semibold px-[3px] leading-none"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export default function MainLayout() {
  const { currentWorkspace, activeChannelId, activeChannelKind, dmConversations, setWorkspace, setChannels, setActiveChannel } = useWorkspaceStore();
  const myHomeView: RoleHomeView = currentWorkspace?.my_home_view ?? 'user';
  const useRoleHome = ROLE_SPECIFIC_HOMES.includes(myHomeView);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const pmReset = usePMStore((s) => s.reset);
  const activeListId = usePMStore((s) => s.activeListId);
  const activeFolderId = usePMStore((s) => s.activeFolderId);
  const activeSpacePageId = usePMStore((s) => s.activeSpacePageId);
  const activeDesignFolderId = usePMStore((s) => s.activeDesignFolderId);
  const userType = useUserType();
  const isPartner = useIsPartner();
  const [activeSection, setActiveSection] = useState<ActiveSection>('home');
  const [homeView, setHomeView] = useState<HomeView>('hub');
  const { data: unreadCount = 0 } = useUnreadCount();
  useNotificationSocket();
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

  // Auto-switch to tasks view when a list is selected
  useEffect(() => {
    if (activeListId) { setHomeView('tasks'); setMobileDrawerOpen(false); }
  }, [activeListId]);

  // Auto-switch to tasks view when a folder is selected
  useEffect(() => {
    if (activeFolderId) { setHomeView('tasks'); setMobileDrawerOpen(false); }
  }, [activeFolderId]);

  // Auto-switch to tasks view when a space is opened (space page)
  useEffect(() => {
    if (activeSpacePageId) { setHomeView('tasks'); setMobileDrawerOpen(false); }
  }, [activeSpacePageId]);

  // Auto-switch to tasks view when a client opens a design folder
  useEffect(() => {
    if (activeDesignFolderId) { setHomeView('tasks'); setMobileDrawerOpen(false); }
  }, [activeDesignFolderId]);

  // Fetch workspaces
  const { data: workspacesRes, isLoading: workspacesLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces').then((r) => r.data),
  });

  const workspaces: (Workspace & { my_role?: string; my_home_view?: RoleHomeView })[] = useMemo(() => workspacesRes?.data || [], [workspacesRes]);

  // Auto-select first workspace on first load, and re-sync whenever the
  // React Query refetch surfaces a changed my_role / my_home_view for the
  // active workspace (e.g. an admin edited the role mid-session). Without
  // this, the Zustand store freezes on its initial value and users have to
  // hard-refresh to pick up role changes.
  useEffect(() => {
    if (workspaces.length === 0) return;
    const next = currentWorkspace
      ? (workspaces.find((w) => w.id === currentWorkspace.id) ?? workspaces[0])
      : workspaces[0];
    if (
      !currentWorkspace ||
      currentWorkspace.id !== next.id ||
      currentWorkspace.my_home_view !== next.my_home_view ||
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

  // Deep link handler — desktop companion app opens URLs with query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openTask = params.get('open_task');
    const openChannel = params.get('open_channel');
    const openInbox = params.get('open_inbox');
    if (openInbox) {
      setActiveSection('home');
      setHomeView('inbox');
      // Store the notification ID so InboxView can auto-select it
      window.__pendingInboxNotificationId = openInbox;
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

  const activeChannel = channels.find((c) => c.id === activeChannelId);

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
          <div className="grid h-7 w-7 place-items-center rounded-[8px] bg-[var(--sh-ink)] text-[var(--sidebar)]" style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', fontSize: 18, letterSpacing: '-0.02em' }}>S</div>
          <span className="text-[13px] font-medium text-[var(--sh-ink)] truncate max-w-[140px]">
            {activeSection === 'home' ? SECTION_TITLES.home : SECTION_TITLES[activeSection]}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateTaskModal(true)}
          aria-label="Create new task"
          className="grid h-9 w-9 place-items-center rounded-[8px] text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)]"
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
          style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', fontSize: 22, letterSpacing: '-0.02em', boxShadow: 'var(--sh-shadow-sm)' }}
          title="SquadHub"
        >
          S
        </div>

        {/* Main nav: Home / Inbox / Tasks / Docs / Cal / Apps */}
        <div className="flex w-full flex-col items-center gap-[2px]">
          <RailBtn
            icon={ICON.home}
            label="My Home"
            active={activeSection === 'home' && homeView === 'hub'}
            onClick={() => { setActiveSection('home'); setHomeView('hub'); }}
          />
          <RailBtn
            icon={ICON.inbox}
            label="Inbox"
            badge={unreadCount > 0 ? unreadCount : undefined}
            active={activeSection === 'home' && homeView === 'inbox'}
            onClick={() => { setActiveSection('home'); setHomeView('inbox'); }}
          />
          <RailBtn
            icon={ICON.tasks}
            label="Tasks"
            active={activeSection === 'home' && homeView === 'my-tasks'}
            onClick={() => { setActiveSection('home'); setHomeView('my-tasks'); }}
          />
          <RailBtn icon={ICON.docs} label="Docs" active={activeSection === 'docs'} onClick={() => setActiveSection('docs')} />
          <RailBtn icon={ICON.cal}  label="Cal"  active={activeSection === 'cal'}  onClick={() => setActiveSection('cal')} />
          <RailBtn icon={ICON.apps} label="Apps" active={activeSection === 'apps'} onClick={() => setActiveSection('apps')} />
          <RailBtn icon={ICON.learning} label="Learning" active={activeSection === 'learning'} onClick={() => setActiveSection('learning')} />
          <button
            onClick={(e) => {
              setTimesheetAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
              setTimesheetOpen((v) => !v);
            }}
            title="Time sheet"
            className={`relative grid h-10 w-10 place-items-center rounded-[9px] transition ${
              timesheetOpen
                ? 'border border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink)]'
                : 'border border-transparent text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
            }`}
            style={timesheetOpen ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
          >
            {ICON.timesheet}
          </button>
        </div>

        {/* Divider */}
        <div className="h-px w-7 bg-[var(--sh-hair-2)] my-2" />

        {/* Second nav: Clients / More */}
        <div className="flex w-full flex-col items-center gap-[2px]">
          <RailBtn icon={ICON.users} label="Clients" active={activeSection === 'clients'} onClick={() => setActiveSection('clients')} />
          <RailBtn icon={ICON.more}  label="More"    active={activeSection === 'more'}    onClick={() => setActiveSection('more')} />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom group: theme + avatar with profile popover */}
        <div className="flex w-full flex-col items-center gap-[2px]">
          <div className="grid h-10 w-10 place-items-center">
            <ThemeToggle />
          </div>
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen((v) => !v)}
              className="mt-1 grid h-8 w-8 place-items-center rounded-full bg-[var(--sh-ink)] text-[var(--sidebar)] text-[11px] font-semibold relative cursor-pointer"
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
        </div>
      </div>

      {/* Module sidebar — always visible, flat edges, drop shadow to the right */}
      {currentWorkspace && activeSection !== 'learning' && (
        <div
          className={`flex h-full shrink-0 flex-col overflow-hidden bg-[var(--sidebar)] border-r border-[var(--sh-hair)] relative z-[2] transition-[width] duration-200 ease-in-out ${
            sidebarOpen ? 'w-[280px]' : 'w-0'
          }`}
          style={{ boxShadow: 'var(--sh-sidebar-drop)' }}
        >
          <HomeSidebar
            workspaceId={currentWorkspace.id}
            channels={channels}
            activeChannelId={activeChannelId}
            homeView={homeView}
            onChangeView={(v) => { setActiveSection('home'); setHomeView(v); setMobileDrawerOpen(false); }}
            onSelectChannel={handleSelectChannel}
            onSelectDm={handleSelectDm}
            onCreateChannel={() => setShowCreateChannel(true)}
            onOpenSpaces={handleOpenSpaces}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </div>
      )}
      </aside>

      {/* Main content area */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-surface pt-12 md:pt-0">
        {/* Universal "New task" button — visible in all views. Hidden on
            mobile because the mobile top bar has its own "+" button. */}
        <button
          type="button"
          onClick={() => setShowCreateTaskModal(true)}
          title="New task"
          aria-label="Create new task"
          className="absolute right-3 top-2 z-40 hidden h-8 w-8 place-items-center rounded-[9px] border border-transparent text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] transition md:grid"
        >
          <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <EmergencyBanner />
        <ActiveTimer />
        {activeSection === 'learning' ? (
          <LearningShell />
        ) : activeSection !== 'home' ? (
          <div className="sh-view flex flex-1 flex-col items-center justify-center">
            <div className="mb-4 opacity-20 text-[var(--sh-ink-3)]">{ICON[(activeSection === 'clients' ? 'users' : activeSection) as keyof typeof ICON]}</div>
            <h3 className="serif text-[40px] text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', letterSpacing: '-0.01em' }}>{SECTION_TITLES[activeSection]}</h3>
            <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">Coming soon</p>
          </div>
        ) : homeView === 'inbox' ? (
          <InboxView setHomeView={setHomeView} />
        ) : homeView === 'my-tasks' ? (
          <MyTasksView />
        ) : homeView === 'day-planner' ? (
          <DayPlannerView />
        ) : homeView === 'mentions' ? (
          <div className="sh-view flex flex-1 flex-col items-center justify-center">
            <h3 className="serif text-[40px] text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', letterSpacing: '-0.01em' }}>Mentions</h3>
            <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">Coming soon</p>
          </div>
        ) : homeView === 'later' ? (
          <div className="sh-view flex flex-1 flex-col items-center justify-center">
            <h3 className="serif text-[40px] text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', letterSpacing: '-0.01em' }}>Later</h3>
            <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">Coming soon</p>
          </div>
        ) : (
          homeView === 'chat' ? (
            <>
              {activeChannelId && (() => {
                const isDm = activeChannelKind === 'dm';
                const activeDm = isDm ? dmConversations.find((d) => d.id === activeChannelId) : null;
                const meId = user?.id;
                const otherParticipants = (activeDm?.participants || []).filter((p) => p.id !== meId);
                const dmTitle = isDm
                  ? (otherParticipants.length === 0
                      ? 'Note to self'
                      : otherParticipants.length === 1
                        ? otherParticipants[0].display_name
                        : `${otherParticipants[0].display_name} +${otherParticipants.length - 1}`)
                  : null;
                return (
                <div className="flex flex-col border-b border-divider">
                  <div className="flex items-center justify-between px-2 py-[7px]">
                    <div className="flex items-center gap-1 w-full md:w-[360px] min-w-0">
                      {/* Title with hash (channel) or avatar (DM) */}
                      <div className="flex items-center gap-1.5 rounded px-2 py-1 overflow-hidden">
                        {isDm ? (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-[#E2E8F0] text-[10px] font-bold text-[#0F172B]">
                            {(otherParticipants[0]?.display_name?.[0] || '?').toUpperCase()}
                          </span>
                        ) : (
                          <svg className="h-4 w-4 shrink-0 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                          </svg>
                        )}
                        <span className="text-[18px] font-black leading-[26px] text-foreground">
                          {isDm ? dmTitle : activeChannel?.name}
                        </span>
                        <svg className="h-4 w-4 shrink-0 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      {!isDm && activeChannel?.description && (
                        <span className="text-[12px] leading-[16px] text-foreground-muted truncate flex-1">
                          {activeChannel.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      {/* Settings */}
                      <button
                        onClick={() => setShowChannelSettings(!showChannelSettings)}
                        className={`rounded-[7px] border border-divider p-1.5 transition ${
                          showChannelSettings ? 'bg-surface-alt text-foreground' : 'text-foreground-muted hover:bg-surface-alt hover:text-foreground'
                        }`}
                        title="Channel settings"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                );
              })()}
              <div className="flex flex-1 overflow-hidden">
                {activeChannelId ? (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <ChatPanel channelId={activeChannelId} kind={activeChannelKind} />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-foreground-dim">
                    Select a channel to start chatting
                  </div>
                )}
                {showChannelSettings && activeChannelId && (() => {
                  const ch = channels.find((c) => c.id === activeChannelId);
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
            </>
          ) : homeView === 'tasks' ? (
            activeDesignFolderId ? (
              <ClientDesignDashboard folderId={activeDesignFolderId} />
            ) : activeFolderId && !activeListId ? (
              <FolderPage />
            ) : activeSpacePageId && !activeListId && !activeFolderId ? (
              <SpacePage />
            ) : (
              <ListPage />
            )
          ) : homeView === 'checkin' ? (
            <CheckInWidget title="Daily Check-In Teammates" context="teammates" />
          ) : homeView === 'checkin-partners' ? (
            <CheckInWidget title="Daily Check-In Partners" context="partners" />
          ) : homeView === 'time-management' ? (
            <TimeManagementPage />
          ) : homeView === 'sales-leads' ? (
            <SalesLeadsPage />
          ) : homeView === 'hub' && !useRoleHome && (userType === 'client' || userType === 'client_staff') ? (
            <ClientDashboard />
          ) : homeView === 'hub' && !useRoleHome && isPartner ? (
            <PartnerDashboard />
          ) : homeView === 'cashbook' && isPartner ? (
            <PartnerCashBook />
          ) : homeView === 'cashbook' && (userType === 'client' || userType === 'client_staff') ? (
            <ClientCashBook />
          ) : homeView === 'published-cards' && (userType === 'client' || userType === 'client_staff') ? (
            <ClientPublishedCards />
          ) : homeView === 'opportunities' && isPartner ? (
            <PartnerOpportunities />
          ) : (
            (() => {
              const HomeComponent = HOME_BY_VIEW[myHomeView] ?? UserHome;
              return <HomeComponent onOpenInbox={() => { setActiveSection('home'); setHomeView('inbox'); }} />;
            })()
          )
        )}
      </div>

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

      {/* Floating draft tasks widget */}
      <DraftTasksWidget
        onResumeDraft={(saved) => {
          setResumingDraft(saved);
          setShowCreateTaskModal(true);
        }}
      />

      {/* Toast notifications */}
      <ToastContainer />

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
