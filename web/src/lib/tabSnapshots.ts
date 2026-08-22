// Pure helpers for the top tab strip. A "tab" is a persisted, labeled
// description of a main-content view — structurally identical to MainLayout's
// `NavSnapshot` (the object `useNavHistory` already snapshots and restores), so
// the existing render switch needs no changes. Tabs only manipulate the same
// section/homeView/pmStore/workspaceStore state the app already uses.
//
// Kept free of React and store imports (types only) so it never participates in
// an import cycle and stays trivially testable.
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { ActiveSection, HomeView } from '../layouts/MainLayout';
import type { ChatKind } from '../stores/workspaceStore';

export interface TabSnapshot {
  section: ActiveSection;
  homeView: HomeView;
  channelId: string | null;
  channelKind: ChatKind;
  spaceId: string | null;
  listId: string | null;
  folderId: string | null;
  spacePageId: string | null;
  designFolderId: string | null;
  // External web page opened inside the app (e.g. a meeting link). When set, the
  // tab renders an <iframe> pane instead of an internal view; the other fields
  // carry a benign home/hub base so the rest of the nav plumbing stays happy.
  externalUrl?: string | null;
  externalTitle?: string | null;
}

export type TabKind = 'list' | 'folder' | 'space' | 'designFolder' | 'app' | 'chat' | 'home' | 'external';

// Mini-app home views — keep in sync with the `view` values in config/apps.tsx.
// Hardcoded (rather than importing APPS) so this stays a dependency-free leaf
// module; APPS pulls in the SSO/axios chain we don't want here.
const APP_VIEWS = new Set<string>([
  'checkin',
  'checkin-partners',
  'check-ins',
  'time-management',
  'clips',
  'sales-leads',
  'candidates',
  'cashbook',
  'partner-payments',
]);

/**
 * Stable identity for a tab — two snapshots with the same key are "the same
 * destination" (used to dedupe / focus-existing). Mirrors MainLayout's `navKey`
 * logic, except mini-apps are keyed by their view so each distinct app is its
 * own tab regardless of whether it was opened from the Home or Apps section.
 */
export function canonicalKey(s: TabSnapshot): string {
  // Each distinct external URL is its own tab.
  if (s.externalUrl) return `ext:${s.externalUrl}`;
  if (s.section === 'home') {
    if (s.homeView === 'chat') return `chat:${s.channelKind}:${s.channelId ?? ''}`;
    if (s.homeView === 'tasks') {
      // Exactly one of these is set (the pm setters clear siblings).
      if (s.designFolderId) return `designFolder:${s.designFolderId}`;
      if (s.listId) return `list:${s.listId}`;
      if (s.folderId) return `folder:${s.folderId}`;
      if (s.spacePageId) return `space:${s.spacePageId}`;
      return 'tasks:empty';
    }
    return `view:${s.homeView}`;
  }
  // Apps module: dedupe to the same tab as the equivalent home-section app view.
  if (s.section === 'apps') return `view:${s.homeView}`;
  // cal / docs / learning / teams / more — one tab per section.
  return `section:${s.section}`;
}

export function tabKind(s: TabSnapshot): TabKind {
  if (s.externalUrl) return 'external';
  if (s.section === 'home' && s.homeView === 'tasks') {
    if (s.designFolderId) return 'designFolder';
    if (s.listId) return 'list';
    if (s.folderId) return 'folder';
    if (s.spacePageId) return 'space';
    return 'home';
  }
  if (s.section === 'home' && s.homeView === 'chat') return 'chat';
  if (s.section === 'apps') return 'app';
  return APP_VIEWS.has(s.homeView) ? 'app' : 'home';
}

// ---- Snapshot builders (used by the sidebars for "open in new tab") ----

function base(section: ActiveSection, homeView: HomeView): TabSnapshot {
  return {
    section,
    homeView,
    channelId: null,
    channelKind: 'channel',
    spaceId: null,
    listId: null,
    folderId: null,
    spacePageId: null,
    designFolderId: null,
    externalUrl: null,
    externalTitle: null,
  };
}

/** A tab that embeds an external web page (e.g. a meeting link) in an iframe. */
export function buildExternalSnapshot(url: string, title?: string | null): TabSnapshot {
  return { ...base('home', 'hub'), externalUrl: url, externalTitle: title ?? null };
}

export function buildListSnapshot(spaceId: string, listId: string): TabSnapshot {
  return { ...base('home', 'tasks'), spaceId, listId };
}
export function buildFolderSnapshot(spaceId: string, folderId: string): TabSnapshot {
  return { ...base('home', 'tasks'), spaceId, folderId };
}
export function buildDesignFolderSnapshot(spaceId: string, folderId: string): TabSnapshot {
  return { ...base('home', 'tasks'), spaceId, designFolderId: folderId };
}
export function buildSpaceSnapshot(spaceId: string): TabSnapshot {
  return { ...base('home', 'tasks'), spaceId, spacePageId: spaceId };
}
export function buildAppSnapshot(view: HomeView, section: ActiveSection = 'apps'): TabSnapshot {
  return base(section, view);
}
export function buildChatSnapshot(channelId: string, kind: ChatKind): TabSnapshot {
  return { ...base('home', 'chat'), channelId, channelKind: kind };
}
export function buildHomeSnapshot(homeView: HomeView = 'hub'): TabSnapshot {
  return base('home', homeView);
}

/** True for a gesture that should open a destination in a NEW tab: ⌘/Ctrl-click or middle-click. */
export function wantsNewTab(e: ReactMouseEvent): boolean {
  return e.metaKey || e.ctrlKey || e.button === 1;
}
