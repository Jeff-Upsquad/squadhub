import { useState } from 'react';
import type { Channel } from '@squadhub/shared';
import type { HomeView } from '../../layouts/MainLayout';
import { useFavorites, useRemoveFavorite } from '../../hooks/useFavorites';
import { useSharedWithMe } from '../../hooks/useSharedWithMe';
import { useHasPermission } from '../../hooks/usePermissions';
import { usePMStore } from '../../stores/pmStore';
import SpaceTree from './pm/SpaceTree';
import CreateSpaceModal from './pm/CreateSpaceModal';
import { useHasMiniApp } from '../../hooks/useMiniApps';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useIsInternal, useIsClient, useIsPartner } from '../../hooks/useUserType';
import { useMyClients, useClientFolders, type MyClientEntry } from '../../hooks/useMyClients';
import { useIsWorkspaceAdmin } from '../../hooks/useIsWorkspaceAdmin';
import AddClientSpaceModal from './clients/AddClientSpaceModal';

// ---- Props ----
interface HomeSidebarProps {
  workspaceId: string;
  channels: Channel[];
  activeChannelId: string | null;
  homeView: HomeView;
  onChangeView: (view: HomeView) => void;
  onSelectChannel: (channelId: string) => void;
  onCreateChannel: () => void;
  onOpenSpaces: () => void;
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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  count?: number;
  unread?: boolean;
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
        <span
          className={`text-[10.5px] font-semibold rounded-full px-[6px] py-[1px] leading-none ${
            unread
              ? 'bg-[var(--sh-ink)] text-[var(--sidebar)]'
              : 'bg-[var(--sh-hair-3)] text-[var(--sh-ink-3)]'
          }`}
          style={{ fontFamily: 'var(--font-mono, JetBrains Mono, monospace)' }}
        >
          {count}
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
  onChangeView,
  onSelectChannel,
  onCreateChannel,
  onOpenSpaces,
}: HomeSidebarProps) {
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);
  const { data: favorites, isLoading: favoritesLoading } = useFavorites(workspaceId);
  const { data: sharedItems, isLoading: sharedLoading } = useSharedWithMe(workspaceId);
  const { data: myClients, isLoading: myClientsLoading, isError: myClientsError } = useMyClients();
  const removeFavorite = useRemoveFavorite(workspaceId);
  const { setActiveSpace, setActiveList, setActiveFolder, setActiveSpacePage } = usePMStore();
  const canCreateChannels = useHasPermission('can_create_channels');
  const canCreateSpaces = useHasPermission('can_create_spaces');
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [addSpaceForClient, setAddSpaceForClient] = useState<MyClientEntry | null>(null);
  const isInternal = useIsInternal();
  const isClient = useIsClient();
  const isPartner = useIsPartner();
  const hasCheckin = useHasMiniApp('daily-checkin');
  const hasCheckinPartners = useHasMiniApp('daily-checkin-partners');
  const hasTimeManagement = useHasMiniApp('time-management');
  const hasSalesLeads = useHasMiniApp('sales-leads');

  const [expandedSections, setExpandedSections] = useState({
    favorites: true,
    clients: true,
    sharedWithMe: true,
    spaces: true,
    channels: true,
    dms: true,
  });

  const toggleSection = (key: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex h-full w-full flex-col text-[var(--sh-ink-2)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--sh-hair)] px-4 py-3">
        <button className="flex items-center gap-2 hover:opacity-80 transition">
          <span
            className="grid h-[22px] w-[22px] place-items-center rounded-[6px] bg-[var(--sh-ink)] text-[var(--sidebar)]"
            style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', fontSize: 12, fontWeight: 700 }}
          >
            {(currentWorkspace?.name || 'S').charAt(0).toUpperCase()}
          </span>
          <span className="text-[13.5px] font-semibold text-[var(--sh-ink)]">
            {currentWorkspace?.name || 'Home'}
          </span>
          <svg className="h-3.5 w-3.5 text-[var(--sh-ink-3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-[2px]">
          <button className="grid h-[26px] w-[26px] place-items-center rounded-[6px] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] transition" title="Filter">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
            </svg>
          </button>
          <button className="grid h-[26px] w-[26px] place-items-center rounded-[6px] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] transition" title="New message">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-2 border-b border-[var(--sh-hair)] relative">
        <svg className="absolute left-[20px] top-1/2 -translate-y-1/2 h-[13px] w-[13px] text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          className="w-full pl-[30px] pr-10 py-[7px] bg-[var(--surface)] border border-[var(--sh-hair)] rounded-lg text-[12.5px] text-[var(--sh-ink)] outline-none placeholder:text-[var(--sh-ink-4)] focus:border-[var(--sh-ink-4)]"
          placeholder="Search or jump to…"
        />
        <span
          className="absolute right-[18px] top-1/2 -translate-y-1/2 text-[10px] text-[var(--sh-ink-4)] bg-[var(--sh-hair-3)] border border-[var(--sh-hair)] rounded px-[4px] py-[1px]"
          style={{ fontFamily: 'var(--font-mono, JetBrains Mono, monospace)' }}
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
            label="Home"
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
            count={8}
            unread
            onClick={() => onChangeView('inbox')}
          />
          <NavItem
            icon={
              <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="m8.5 12.5 2.5 2.5 4.5-5" />
              </svg>
            }
            label="My Tasks"
            active={homeView === 'my-tasks'}
            count={14}
            onClick={() => onChangeView('my-tasks')}
          />
          <NavItem
            icon={
              <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4" />
                <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
              </svg>
            }
            label="Mentions"
            active={homeView === 'mentions'}
            count={3}
            unread
            onClick={() => onChangeView('mentions')}
          />
          <NavItem
            icon={
              <svg className="h-[14px] w-[14px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            }
            label="Later"
            active={homeView === 'later'}
            onClick={() => onChangeView('later')}
          />

          {isInternal && hasCheckin && (
            <button
              onClick={() => onChangeView('checkin')}
              className={`flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
                homeView === 'checkin'
                  ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                  : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
              }`}
              style={homeView === 'checkin' ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
            >
              <svg className={`h-[14px] w-[14px] shrink-0 ${homeView === 'checkin' ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Daily Check-In
            </button>
          )}

          {isInternal && hasCheckinPartners && (
            <button
              onClick={() => onChangeView('checkin-partners')}
              className={`flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
                homeView === 'checkin-partners'
                  ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                  : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
              }`}
              style={homeView === 'checkin-partners' ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
            >
              <svg className={`h-[14px] w-[14px] shrink-0 ${homeView === 'checkin-partners' ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Daily Check-In
            </button>
          )}

          {isInternal && hasTimeManagement && (
            <button
              onClick={() => onChangeView('time-management')}
              className={`flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
                homeView === 'time-management'
                  ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                  : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
              }`}
              style={homeView === 'time-management' ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
            >
              <svg className={`h-[14px] w-[14px] shrink-0 ${homeView === 'time-management' ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Time Management
            </button>
          )}

          {isInternal && hasSalesLeads && (
            <button
              onClick={() => onChangeView('sales-leads')}
              className={`flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
                homeView === 'sales-leads'
                  ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                  : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
              }`}
              style={homeView === 'sales-leads' ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
            >
              <svg className={`h-[14px] w-[14px] shrink-0 ${homeView === 'sales-leads' ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Sales Leads
            </button>
          )}

          {(isPartner || isClient) && (
            <button
              onClick={() => onChangeView('cashbook')}
              className={`flex w-full items-center gap-[9px] rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
                homeView === 'cashbook'
                  ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                  : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
              }`}
              style={homeView === 'cashbook' ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
            >
              <svg className={`h-[14px] w-[14px] shrink-0 ${homeView === 'cashbook' ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
              Cash Book
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="mx-2 border-t border-[var(--sh-hair)]" />

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
              {favorites?.map((fav) => (
                <div key={fav.id} className="group flex items-center">
                  <button
                    onClick={() => {
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
                    }}
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
              ))}
            </div>
          )}
        </div>

        {/* Clients section — hidden for client users; otherwise always visible */}
        {!isClient && (
          <>
            <div className="mx-2 border-t border-[var(--sh-hair)]" />
            <div className="pb-1">
              <SectionHeader
                title="Clients"
                expanded={expandedSections.clients}
                onToggle={() => toggleSection('clients')}
              />
              {expandedSections.clients && (
                <div className="pb-1">
                  {myClientsLoading ? (
                    <p className="px-3 py-[5px] text-[11.5px] text-[var(--sh-ink-4)]">Loading…</p>
                  ) : myClientsError ? (
                    <p className="px-3 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">Couldn't load clients</p>
                  ) : !myClients || myClients.length === 0 ? (
                    <p className="px-3 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">No clients yet</p>
                  ) : (
                    myClients.map((entry) => (
                      <ClientRow
                        key={entry.id}
                        entry={entry}
                        onAddSpace={() => setAddSpaceForClient(entry)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Shared with me section — only show when there are shared items */}
        {sharedItems && sharedItems.length > 0 && (
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
                      onClick={() => {
                        if (item.resource_type === 'list') {
                          setActiveSpace(item.space_id);
                          setActiveList(item.resource_id);
                        }
                      }}
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

        {/* Spaces section — hidden for client users */}
        {!isClient && (
          <>
            <div className="pb-1">
              <SectionHeader
                title="Spaces"
                expanded={expandedSections.spaces}
                onToggle={() => toggleSection('spaces')}
                action={
                  canCreateSpaces ? (
                    <button
                      onClick={() => setShowCreateSpace(true)}
                      className="text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)]"
                      title="Create space"
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
          />
          {expandedSections.dms && (
            <div className="px-2 pb-1">
              <p className="px-2 py-2 text-center text-[11.5px] text-[var(--sh-ink-4)]">No direct messages yet</p>
            </div>
          )}
        </div>
      </div>

      {addSpaceForClient && (
        <AddClientSpaceModal
          clientId={addSpaceForClient.client_id}
          clientName={addSpaceForClient.client.business_name}
          onClose={() => setAddSpaceForClient(null)}
        />
      )}
    </div>
  );
}

// ---- Client row (collapsible list of a client's spaces) ----
function ClientRow({
  entry,
  onAddSpace,
}: {
  entry: MyClientEntry;
  onAddSpace: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const setActiveDesignFolder = usePMStore((s) => s.setActiveDesignFolder);
  const activeDesignFolderId = usePMStore((s) => s.activeDesignFolderId);
  const { data: foldersRes, isLoading } = useClientFolders(expanded ? entry.client_id : null);
  const folders = foldersRes?.folders || [];
  const isWorkspaceAdmin = useIsWorkspaceAdmin();

  return (
    <div className="px-2">
      <div className="group flex items-center">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)]"
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
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] px-[5px] py-[5px] text-left text-[13px] text-[var(--sh-ink-2)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-[var(--sh-hair-3)] text-[9px] font-semibold uppercase text-[var(--sh-ink-2)]">
            {entry.client.business_name.slice(0, 2)}
          </span>
          <span className="truncate">{entry.client.business_name}</span>
        </button>
        {isWorkspaceAdmin && (
          <button
            onClick={onAddSpace}
            title="Add space"
            className="mr-1 hidden rounded p-0.5 text-[var(--sh-ink-4)] transition hover:text-[var(--sh-ink)] group-hover:block"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>
      {expanded && (
        <div className="pb-1 pl-8 pr-2">
          {isLoading && (
            <p className="px-2 py-1 text-[11px] text-[var(--sh-ink-4)]">Loading…</p>
          )}
          {!isLoading && folders.length === 0 && (
            <p className="px-2 py-1 text-[11px] text-[var(--sh-ink-4)]">
              {isWorkspaceAdmin ? 'No spaces yet. Click + to add.' : 'No spaces yet.'}
            </p>
          )}
          {folders.map((f) => {
            const isActive = f.id === activeDesignFolderId;
            const isDesign = (f.client_space_template as any)?.slug === 'design-space';
            return (
              <button
                key={f.id}
                onClick={() => setActiveDesignFolder(f.id)}
                className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left text-[13px] transition ${
                  isActive
                    ? 'bg-[var(--surface)] text-[var(--sh-ink)] font-medium border border-[var(--sh-hair)]'
                    : 'text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
                }`}
                style={isActive ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
              >
                <span className={`shrink-0 ${isActive ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)]'}`}>
                  {isDesign ? (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  )}
                </span>
                <span className="truncate">{f.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
