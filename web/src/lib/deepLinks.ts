// In-app deep links — URLs that land on a specific chat message, thread, or
// task comment. MainLayout parses them on load (`?open_*` query params) and
// listens for DEEP_LINK_EVENT so a click on one inside the app (e.g. a link in
// a task description) navigates in place instead of opening a new tab.

import { create } from 'zustand';
import type { ChatKind } from '../stores/workspaceStore';

export const DEEP_LINK_EVENT = 'squadhub:deep-link';

function appUrl(params: Record<string, string | null | undefined>): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return `${origin}/app?${qs.toString()}`;
}

// A chat message. `parentId` (the thread root) opens it inside its thread;
// passing the message's own id as parentId opens the thread it starts.
export function messageLink(target: {
  conversationId: string;
  kind: ChatKind;
  messageId: string;
  parentId?: string | null;
}): string {
  return appUrl({
    open_message: target.messageId,
    conv: target.conversationId,
    kind: target.kind,
    parent: target.parentId,
  });
}

export function commentLink(taskId: string, commentId: string): string {
  return appUrl({ open_task: taskId, comment: commentId });
}

// True for a same-origin URL carrying one of the params MainLayout handles.
export function isInAppDeepLink(href: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(href, window.location.origin);
    if (u.origin !== window.location.origin) return false;
    return ['open_message', 'open_task', 'open_channel', 'open_inbox'].some((k) => u.searchParams.has(k));
  } catch {
    return false;
  }
}

export function dispatchDeepLink(href: string): void {
  window.dispatchEvent(new CustomEvent(DEEP_LINK_EVENT, { detail: { href } }));
}

// Comment to scroll to + flash once its task's panel has loaded it. A store
// (not a window global) so an already-open task panel reacts to a new link.
export const useDeepLinkStore = create<{
  pendingCommentId: string | null;
  setPendingComment: (id: string | null) => void;
}>((set) => ({
  pendingCommentId: null,
  setPendingComment: (id) => set({ pendingCommentId: id }),
}));
