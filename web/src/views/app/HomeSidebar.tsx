import { useState } from 'react';
import type { Channel } from '@squadhub/shared';
import type { HomeView } from '../../layouts/MainLayout';
import { useFavorites, useRemoveFavorite } from '../../hooks/useFavorites';
import { useHasPermission } from '../../hooks/usePermissions';
import SpaceTree from './pm/SpaceTree';
import { useHasMiniApp } from '../../hooks/useMiniApps';

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
  const cls = 'h-4 w-4 shrink-0 text-[#90A1B9]';
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

// ---- Collapsible section header ----
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
    <div className="flex items-center justify-between px-4 py-2">
      <button onClick={onToggle} className="flex items-center gap-1.5 text-[#62748E] transition hover:text-[#0F172B]">
        <svg
          className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em]">{title}</span>
      </button>
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
  const { data: favorites, isLoading: favoritesLoading } = useFavorites(workspaceId);
  const removeFavorite = useRemoveFavorite(workspaceId);
  const canCreateChannels = useHasPermission('can_create_channels');
  const hasCheckin = useHasMiniApp('daily-checkin');

  const [activeTab, setActiveTab] = useState<HomeTab>('unread');
  const [expandedSections, setExpandedSections] = useState({
    favorites: true,
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
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E0E4E8] px-4 py-3">
        <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-[#0F172B]">Home</h2>
      </div>

      {/* Tab pills */}
      <div className="flex gap-1.5 border-b border-[#E0E4E8] px-4 py-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              activeTab === tab.id
                ? 'bg-[#0F172B] text-white'
                : 'bg-white/50 text-[#62748E] hover:bg-white hover:text-[#0F172B]'
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
          <button className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-[#62748E] transition hover:bg-white/70 hover:text-[#0F172B]">
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3" />
            </svg>
            Inbox
          </button>

          <button className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-[#62748E] transition hover:bg-white/70 hover:text-[#0F172B]">
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            New Tasks
          </button>

          <button className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm text-[#62748E] transition hover:bg-white/70 hover:text-[#0F172B]">
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            Assigned Comments
          </button>

          {hasCheckin && (
            <button
              onClick={() => onChangeView('checkin')}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition ${
                homeView === 'checkin'
                  ? 'bg-white text-[#0F172B] font-medium'
                  : 'text-[#62748E] hover:bg-white/70 hover:text-[#0F172B]'
              }`}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Daily Check-In
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="mx-4 border-t border-[#E0E4E8]" />

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
                <p className="px-3 py-1.5 text-xs text-[#90A1B9]">Loading...</p>
              )}
              {!favoritesLoading && (!favorites || favorites.length === 0) && (
                <p className="px-3 py-2 text-center text-xs text-[#90A1B9]">
                  Star items to pin them here
                </p>
              )}
              {favorites?.map((fav) => (
                <div key={fav.id} className="group flex items-center">
                  <button className="flex flex-1 items-center gap-2 rounded-md px-3 py-1 text-left text-sm text-[#62748E] transition hover:bg-white/70 hover:text-[#0F172B]">
                    <FavoriteIcon type={fav.item_type} />
                    <span className="truncate">{fav.item_name}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFavorite.mutate(fav.id); }}
                    className="mr-2 hidden rounded p-0.5 text-[#90A1B9] transition hover:text-[#0F172B] group-hover:block"
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

        {/* Divider */}
        <div className="mx-4 border-t border-[#E0E4E8]" />

        {/* Spaces section */}
        <div className="py-1">
          <SectionHeader
            title="Spaces"
            expanded={expandedSections.spaces}
            onToggle={() => toggleSection('spaces')}
          />
          {expandedSections.spaces && (
            <div className="pb-1">
              <SpaceTree workspaceId={workspaceId} />
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="mx-4 border-t border-[#E0E4E8]" />

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
                  className="text-[#90A1B9] transition hover:text-[#0F172B]"
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
                <p className="px-3 py-2 text-center text-xs text-[#90A1B9]">No channels yet</p>
              ) : (
                channels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => onSelectChannel(ch.id)}
                    className={`mb-0.5 flex w-full items-center rounded-md px-3 py-1 text-left text-sm transition ${
                      activeChannelId === ch.id && homeView === 'chat'
                        ? 'bg-white text-[#0F172B] font-medium'
                        : 'text-[#62748E] hover:bg-white/70 hover:text-[#0F172B]'
                    }`}
                  >
                    <span className="mr-2 text-[#90A1B9]">#</span>
                    <span className="truncate">{ch.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="mx-4 border-t border-[#E0E4E8]" />

        {/* DMs section */}
        <div className="py-1">
          <SectionHeader
            title="Direct Messages"
            expanded={expandedSections.dms}
            onToggle={() => toggleSection('dms')}
          />
          {expandedSections.dms && (
            <div className="px-2 pb-1">
              <p className="px-3 py-2 text-center text-xs text-[#90A1B9]">No direct messages yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
