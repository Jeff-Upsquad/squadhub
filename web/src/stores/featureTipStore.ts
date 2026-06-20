'use client';

// Module store for the Feature Tip overlay (mirrors the Toast.tsx external-store
// pattern). The queue itself is server-driven — MainLayout pushes the result of
// GET /feature-tips/pending in via setQueue. This store only tracks which tip is
// currently shown and relays guided-navigation requests ("Show me") up to
// MainLayout, which owns the actual navigation state.
import { useSyncExternalStore } from 'react';
import type { PendingFeatureTip } from '@squadhub/shared';

let queue: PendingFeatureTip[] = [];
let index = 0;
let listeners: Array<() => void> = [];
let navListeners: Array<(view: string) => void> = [];

// The anchor key the overlay is currently spotlighting (the active tour step's
// target_anchor), or null. Components can react to it — e.g. the Apps module
// reveals its hover-only star while it is the spotlight target.
let activeAnchor: string | null = null;
let anchorListeners: Array<() => void> = [];

function emit() {
  listeners.forEach((l) => l());
}

export const featureTipStore = {
  // Reconciles a fresh pending list against the current queue: reuses existing
  // tip object identities (so an unchanged current tip doesn't force a re-render
  // on every poll) and keeps the currently-shown tip in place when still present.
  setQueue(next: PendingFeatureTip[]) {
    const prev = queue[index] ?? null;
    queue = next.map((t) => {
      const existing = queue.find((q) => q.id === t.id && q.revision === t.revision);
      return existing ?? t;
    });
    if (prev) {
      const i = queue.findIndex((t) => t.id === prev.id && t.revision === prev.revision);
      index = i >= 0 ? i : 0;
    } else {
      index = 0;
    }
    emit();
  },

  // Drop the current tip (it was accepted/dismissed) and advance.
  next() {
    const cur = queue[index];
    if (cur) queue = queue.filter((t) => !(t.id === cur.id && t.revision === cur.revision));
    if (index >= queue.length) index = Math.max(0, queue.length - 1);
    emit();
  },

  subscribe(cb: () => void) {
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  },
  getSnapshot(): PendingFeatureTip | null {
    return queue[index] ?? null;
  },

  // Guided navigation: the overlay asks, MainLayout performs the nav.
  requestNavigate(view: string) {
    navListeners.forEach((l) => l(view));
  },
  subscribeNav(cb: (view: string) => void) {
    navListeners.push(cb);
    return () => {
      navListeners = navListeners.filter((l) => l !== cb);
    };
  },

  // The currently-spotlighted anchor key (set by the overlay as a tour advances).
  setActiveAnchor(anchor: string | null) {
    if (anchor === activeAnchor) return;
    activeAnchor = anchor;
    anchorListeners.forEach((l) => l());
  },
  subscribeAnchor(cb: () => void) {
    anchorListeners.push(cb);
    return () => {
      anchorListeners = anchorListeners.filter((l) => l !== cb);
    };
  },
  getActiveAnchor(): string | null {
    return activeAnchor;
  },
};

/** Current tip to display, or null. */
export function useCurrentTip(): PendingFeatureTip | null {
  return useSyncExternalStore(
    featureTipStore.subscribe,
    featureTipStore.getSnapshot,
    () => null,
  );
}

/** The anchor key currently being spotlighted by a feature tip, or null. */
export function useActiveTipAnchor(): string | null {
  return useSyncExternalStore(
    featureTipStore.subscribeAnchor,
    featureTipStore.getActiveAnchor,
    () => null,
  );
}
