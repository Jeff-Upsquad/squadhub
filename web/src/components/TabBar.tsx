import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTabsStore, type Tab } from '../stores/tabsStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import { useSpace } from '../hooks/useSpaces';
import { APPS, AppIcon } from '../config/apps';
import { tabKind, buildHomeSnapshot, type TabSnapshot } from '../lib/tabSnapshots';

// Chrome-style tab strip across the top of the main content area. Desktop only
// (mobile keeps the single-view behavior). Each tab is a persisted TabSnapshot;
// clicking restores it into the live view via the tabsStore → MainLayout wiring.

const VIEW_LABELS: Record<string, string> = {
  hub: 'Home',
  inbox: 'Inbox',
  'my-tasks': 'My Tasks',
  'day-planner': 'Day Planner',
  routines: 'Routines',
  opportunities: 'Opportunities',
  'subscription-cards': 'Subscription Cards',
};
const SECTION_LABELS: Record<string, string> = {
  cal: 'Calendar',
  docs: 'Documents',
  learning: 'Resources',
  teams: 'Teams',
  more: 'More',
};

function useTabLabel(s: TabSnapshot): string {
  const kind = tabKind(s);
  const isPm = kind === 'list' || kind === 'folder' || kind === 'space' || kind === 'designFolder';
  const channels = useWorkspaceStore((st) => st.channels);
  const dms = useWorkspaceStore((st) => st.dmConversations);
  const meId = useAuthStore((st) => st.user?.id);
  const { data: space } = useSpace(isPm ? s.spaceId : null);

  if (kind === 'external') {
    if (s.externalTitle) return s.externalTitle;
    try {
      return new URL(s.externalUrl!).hostname;
    } catch {
      return s.externalUrl || 'Link';
    }
  }
  if (kind === 'list') {
    const lists = [
      ...(space?.lists ?? []),
      ...((space?.folders ?? []).flatMap((f) => f.lists ?? [])),
    ];
    return lists.find((l) => l.id === s.listId)?.name ?? 'List';
  }
  if (kind === 'folder') return (space?.folders ?? []).find((f) => f.id === s.folderId)?.name ?? 'Folder';
  if (kind === 'designFolder') return (space?.folders ?? []).find((f) => f.id === s.designFolderId)?.name ?? 'Folder';
  if (kind === 'space') return space?.name ?? 'Space';
  if (kind === 'chat') {
    if (s.channelKind === 'dm') {
      const dm = dms.find((d) => d.id === s.channelId);
      const others = (dm?.participants ?? []).filter((p) => p.id !== meId);
      if (others.length === 0) return 'Note to self';
      if (others.length === 1) return others[0].display_name;
      return `${others[0].display_name} +${others.length - 1}`;
    }
    return channels.find((c) => c.id === s.channelId)?.name ?? 'Channel';
  }
  if (kind === 'app') return APPS.find((a) => a.view === s.homeView)?.name ?? 'Apps';
  return VIEW_LABELS[s.homeView] ?? SECTION_LABELS[s.section] ?? 'Home';
}

// ---- Per-kind icons (14px, stroke-1.6 to match the rail) ----
function svg(path: React.ReactNode) {
  return (
    <svg className="h-[13px] w-[13px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      {path}
    </svg>
  );
}

function TabIcon({ s }: { s: TabSnapshot }) {
  const kind = tabKind(s);
  if (kind === 'app') {
    const app = APPS.find((a) => a.view === s.homeView);
    if (app) return <AppIcon paths={app.paths} className="h-[13px] w-[13px] shrink-0" />;
    // Apps-module placeholder (no specific app selected) — the grid icon.
    return svg(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>);
  }
  switch (kind) {
    case 'external':
      return svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>);
    case 'list':
      return svg(<><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>);
    case 'folder':
    case 'designFolder':
      return svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
    case 'space':
      return svg(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>);
    case 'chat':
      return svg(<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />);
    default:
      break;
  }
  // home dashboards / sections — a couple of recognizable ones, else a dot grid.
  if (s.homeView === 'inbox') return svg(<><path d="M3 13V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" /><path d="M3 13h5l2 3h4l2-3h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>);
  if (s.homeView === 'my-tasks') return svg(<><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>);
  if (s.section === 'cal') return svg(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>);
  if (s.section === 'docs') return svg(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></>);
  if (s.section === 'learning') return svg(<path d="M12 6.253v13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253" />);
  return svg(<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />);
}

function CloseIcon() {
  return (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function TabItem({
  tab,
  active,
  onSelect,
  onClose,
  onContextMenu,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  draggable: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  const label = useTabLabel(tab.snapshot);
  return (
    <div
      role="tab"
      aria-selected={active}
      title={label}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onSelect}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      onContextMenu={onContextMenu}
      className={`group relative flex h-[28px] min-w-[92px] max-w-[190px] shrink-0 cursor-default items-center gap-1.5 rounded-[7px] pl-2.5 pr-1.5 text-[12.5px] transition ${
        active
          ? 'border border-[var(--sh-hair)] bg-[var(--surface)] font-medium text-[var(--sh-ink)]'
          : 'border border-transparent text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
      }`}
      style={active ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
    >
      <span className={active ? 'text-[var(--sh-ink)]' : 'text-[var(--sh-ink-4)]'}>
        <TabIcon s={tab.snapshot} />
      </span>
      <span className="flex-1 truncate">{label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close tab"
        title="Close tab"
        className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] text-[var(--sh-ink-4)] transition hover:bg-[var(--sh-hair)] hover:text-[var(--sh-ink)] ${
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export default function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const closeOthers = useTabsStore((s) => s.closeOthers);
  const reorderTabs = useTabsStore((s) => s.reorderTabs);
  const openInNewTab = useTabsStore((s) => s.openInNewTab);

  const dragId = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  // A single tab adds no value — don't show the strip until there are ≥2.
  if (tabs.length <= 1) return null;

  // Hidden on mobile — the mobile layout keeps the single-view behavior.
  return (
    <div className="hidden h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--sh-hair)] bg-[var(--sidebar)] px-2 md:flex">
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          onSelect={() => setActiveTab(tab.id)}
          onClose={() => closeTab(tab.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
          }}
          draggable={tabs.length > 1}
          onDragStart={() => {
            dragId.current = tab.id;
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId.current && dragId.current !== tab.id) reorderTabs(dragId.current, tab.id);
            dragId.current = null;
          }}
        />
      ))}
      <button
        type="button"
        onClick={() => openInNewTab(buildHomeSnapshot('hub'))}
        aria-label="New tab"
        title="New tab"
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
      >
        <svg className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {menu && typeof document !== 'undefined' &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
            <div
              className="fixed z-[61] min-w-[150px] rounded-[8px] border border-[var(--sh-hair)] bg-[var(--surface)] py-1 text-[12.5px] text-[var(--sh-ink-2)] shadow-lg"
              style={{ left: menu.x, top: menu.y }}
            >
              <button
                type="button"
                className="flex w-full items-center px-3 py-1.5 text-left transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                onClick={() => { closeTab(menu.tabId); setMenu(null); }}
              >
                Close tab
              </button>
              <button
                type="button"
                disabled={tabs.length <= 1}
                className="flex w-full items-center px-3 py-1.5 text-left transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] disabled:pointer-events-none disabled:opacity-40"
                onClick={() => { closeOthers(menu.tabId); setMenu(null); }}
              >
                Close other tabs
              </button>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
