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

// ---- Tab pills ----
type HomeTab = 'unread' | 'spaces' | 'chat';

const TABS: { id: HomeTab; label: string }[] = [
  { id: 'unread', label: 'Unread' },
  { id: 'spaces', label: 'Spaces' },
  { id: 'chat', label: 'Chat' },
];

// ---- Favorite icon helper ----
function FavoriteIcon({ type }: { type: string }) {
  const cls = 'h-4 w-4 shrink-0 text-foreground-muted';
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

// ---- Collapsible section header (Slack-style caret-down) ----
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
    <div className="flex items-center justify-between pl-2 pr-4">
      <div className="flex items-center">
        <button onClick={onToggle} className="flex items-start p-1 rounded">
          <svg
            className={`h-[18px] w-[18px] transition-transform ${expanded ? '' : '-rotate-90'}`}
            viewBox="0 0 18 18"
            fill="currentColor"
          >
            <path d="M5 7h8L9 11z" />
          </svg>
        </button>
        <button onClick={onToggle} className="flex items-center rounded-md px-[5px] h-[28px]">
          <span className="text-[15px] font-normal leading-[15px] text-sidebar-text overflow-hidden text-ellipsis whitespace-nowrap">{title}</span>
        </button>
      </div>
      {action}
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
  const removeFavorite = useRemoveFavorite(workspaceId);
  const { setActiveSpace, setActiveList } = usePMStore();
  const canCreateChannels = useHasPermission('can_create_channels');
  const canCreateSpaces = useHasPermission('can_create_spaces');
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const isInternal = useIsInternal();
  const isClient = useIsClient();
  const isPartner = useIsPartner();
  const hasCheckin = useHasMiniApp('daily-checkin');
  const hasCheckinPartners = useHasMiniApp('daily-checkin-partners');
  const hasTimeManagement = useHasMiniApp('time-management');

  const [activeTab, setActiveTab] = useState<HomeTab>('unread');
  const [expandedSections, setExpandedSections] = useState({
    favorites: true,
    sharedWithMe: true,
    spaces: true,
    channels: true,
    dms: true,
  });

  const toggleSection = (key: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleTabChange = (tab: HomeTab) => {
    setActiveTab(tab);
    if (tab === 'spaces') onChangeView('tasks');
    else if (tab === 'chat') onChangeView('chat');
    else onChangeView('hub');
  };

  return (
    <div className="flex h-full w-full flex-col text-sidebar-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-divider px-4 py-3">
        <button className="flex items-center gap-1 text-[18px] font-black leading-[26px] text-sidebar-text hover:opacity-80 transition">
          {currentWorkspace?.name || 'Home'}
          <svg className="h-3.5 w-3.5 ml-0.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-1">
          <button className="rounded p-1 text-foreground-muted hover:bg-sidebar-hover hover:text-sidebar-text transition" title="Filter">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
            </svg>
          </button>
          <button className="rounded p-1 text-foreground-muted hover:bg-sidebar-hover hover:text-sidebar-text transition" title="New message">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tab pills */}
      <div className="flex gap-1.5 border-b border-divider px-4 py-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              activeTab === tab.id
                ? 'bg-sidebar-text text-white'
                : 'bg-sidebar-hover text-foreground-muted hover:bg-sidebar-hover hover:text-sidebar-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Navigation items */}
        <div className="px-2 py-2">
          <button className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-sidebar-text transition hover:bg-sidebar-hover">
            <svg className="h-4 w-4 shrink-0 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3" />
            </svg>
            Inbox
          </button>

          <button className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-sidebar-text transition hover:bg-sidebar-hover">
            <svg className="h-4 w-4 shrink-0 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            New Tasks
          </button>

          <button className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-sidebar-text transition hover:bg-sidebar-hover">
            <svg className="h-4 w-4 shrink-0 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            Assigned Comments
          </button>

          {isInternal && hasCheckin && (
            <button
              onClick={() => onChangeView('checkin')}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition ${
                homeView === 'checkin'
                  ? 'bg-[#1264A3] text-white font-medium'
                  : 'text-sidebar-text hover:bg-sidebar-hover'
              }`}
            >
              <svg className={`h-4 w-4 shrink-0 ${homeView === 'checkin' ? 'text-white' : 'text-foreground-muted'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Daily Check-In
            </button>
          )}

          {isInternal && hasCheckinPartners && (
            <button
              onClick={() => onChangeView('checkin-partners')}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition ${
                homeView === 'checkin-partners'
                  ? 'bg-[#1264A3] text-white font-medium'
                  : 'text-sidebar-text hover:bg-sidebar-hover'
              }`}
            >
              <svg className={`h-4 w-4 shrink-0 ${homeView === 'checkin-partners' ? 'text-white' : 'text-foreground-muted'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Daily Check-In
            </button>
          )}

          {isInternal && hasTimeManagement && (
            <button
              onClick={() => onChangeView('time-management')}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition ${
                homeView === 'time-management'
                  ? 'bg-[#1264A3] text-white font-medium'
                  : 'text-sidebar-text hover:bg-sidebar-hover'
              }`}
            >
              <svg className={`h-4 w-4 shrink-0 ${homeView === 'time-management' ? 'text-white' : 'text-foreground-muted'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Time Management
            </button>
          )}

          {(isPartner || isClient) && (
            <button
              onClick={() => onChangeView('cashbook')}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition ${
                homeView === 'cashbook'
                  ? 'bg-[#1264A3] text-white font-medium'
                  : 'text-sidebar-text hover:bg-sidebar-hover'
              }`}
            >
              <svg className={`h-4 w-4 shrink-0 ${homeView === 'cashbook' ? 'text-white' : 'text-foreground-muted'}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
              Cash Book
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="mx-4 border-t border-divider" />

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
                <p className="px-3 py-1.5 text-xs text-foreground-dim">Loading...</p>
              )}
              {!favoritesLoading && (!favorites || favorites.length === 0) && (
                <p className="px-3 py-2 text-center text-xs text-foreground-dim">
                  Star items to pin them here
                </p>
              )}
              {favorites?.map((fav) => (
                <div key={fav.id} className="group flex items-center">
                  <button className="flex flex-1 items-center gap-2 rounded-md px-3 py-1 text-left text-sm text-sidebar-text transition hover:bg-sidebar-hover">
                    <FavoriteIcon type={fav.item_type} />
                    <span className="truncate">{fav.item_name}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFavorite.mutate(fav.id); }}
                    className="mr-2 hidden rounded p-0.5 text-foreground-muted transition hover:text-sidebar-text group-hover:block"
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

        {/* Shared with me section — only show when there are shared items */}
        {sharedItems && sharedItems.length > 0 && (
          <>
            {/* Divider */}
            <div className="mx-4 border-t border-divider" />

            <div className="py-1">
              <SectionHeader
                title="Shared with me"
                expanded={expandedSections.sharedWithMe}
                onToggle={() => toggleSection('sharedWithMe')}
              />
              {expandedSections.sharedWithMe && (
                <div className="px-2 pb-1">
                  {sharedLoading && (
                    <p className="px-3 py-1.5 text-xs text-foreground-dim">Loading...</p>
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
                      className="flex w-full items-center gap-2 rounded-md px-3 py-1 text-left text-sm text-sidebar-text transition hover:bg-sidebar-hover"
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
        <div className="mx-4 border-t border-divider" />

        {/* Spaces section — hidden for client users */}
        {!isClient && (
          <>
            <div className="py-1">
              <SectionHeader
                title="Spaces"
                expanded={expandedSections.spaces}
                onToggle={() => toggleSection('spaces')}
                action={
                  canCreateSpaces ? (
                    <button
                      onClick={() => setShowCreateSpace(true)}
                      className="text-foreground-muted transition hover:text-sidebar-text"
                      title="Create space"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
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
            <div className="mx-4 border-t border-divider" />
          </>
        )}

        {/* Channels section */}
        <div className="py-1">
          <SectionHeader
            title="Channels"
            expanded={expandedSections.channels}
            onToggle={() => toggleSection('channels')}
            action={
              canCreateChannels ? (
                <button
                  onClick={onCreateChannel}
                  className="text-foreground-muted transition hover:text-sidebar-text"
                  title="Create channel"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              ) : undefined
            }
          />
          {expandedSections.channels && (
            <div className="px-2 pb-1">
              {channels.length === 0 ? (
                <p className="px-3 py-2 text-center text-xs text-foreground-dim">No channels yet</p>
              ) : (
                channels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => onSelectChannel(ch.id)}
                    className={`mb-0.5 flex w-full items-center rounded-md px-3 py-1 text-left text-sm transition ${
                      activeChannelId === ch.id && homeView === 'chat'
                        ? 'bg-[#1264A3] text-white font-medium'
                        : 'text-sidebar-text hover:bg-sidebar-hover'
                    }`}
                  >
                    <span className={`mr-2 ${activeChannelId === ch.id && homeView === 'chat' ? 'text-white/60' : 'text-foreground-muted'}`}>#</span>
                    <span className="truncate">{ch.name}</span>
                  </button>
                ))
              )}
              {/* Add channels */}
              <button
                onClick={onCreateChannel}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1 text-left text-sm text-foreground-dim transition hover:bg-sidebar-hover hover:text-sidebar-text"
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
        <div className="mx-4 border-t border-divider" />

        {/* DMs section */}
        <div className="py-1">
          <SectionHeader
            title="Direct Messages"
            expanded={expandedSections.dms}
            onToggle={() => toggleSection('dms')}
          />
          {expandedSections.dms && (
            <div className="px-2 pb-1">
              <p className="px-3 py-2 text-center text-xs text-foreground-dim">No direct messages yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
