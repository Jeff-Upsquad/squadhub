import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

export interface NavHistoryControls {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

interface NavHistoryOptions<T> {
  /** Full state needed to put the user back on the current page. */
  snapshot: T;
  /**
   * Identity of the current page; a change records a history entry. Leave
   * fields that don't affect what the user sees (e.g. which chat channel is
   * active while a tasks view is open) out of the key so background state
   * changes don't pollute the history.
   */
  key: string;
  /** History is wiped when this changes (e.g. switching workspaces). */
  resetKey?: string;
  /**
   * Owned by the caller. Set true for the commit a restore produces so
   * effects that auto-switch views on state changes can stand down; the
   * caller must clear it in an effect declared after those.
   */
  restoringRef: MutableRefObject<boolean>;
  onRestore: (snapshot: T) => void;
}

interface Entry<T> {
  key: string;
  snap: T;
}

const MAX_ENTRIES = 50;

/**
 * Browser-style back/forward history for state-driven navigation. Records an
 * entry whenever `key` changes and walks the stack on goBack/goForward,
 * handing the stored snapshot to `onRestore` to re-apply.
 */
export function useNavHistory<T>({
  snapshot,
  key,
  resetKey,
  restoringRef,
  onRestore,
}: NavHistoryOptions<T>): NavHistoryControls {
  const past = useRef<Entry<T>[]>([]);
  const future = useRef<Entry<T>[]>([]);
  const current = useRef<Entry<T> | null>(null);
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  // Declared before the recorder so a key change landing in the same commit
  // as a context switch starts from an empty stack.
  const lastReset = useRef(resetKey);
  useEffect(() => {
    if (lastReset.current === resetKey) return;
    lastReset.current = resetKey;
    past.current = [];
    future.current = [];
    current.current = null;
    bump();
  }, [resetKey]);

  useEffect(() => {
    if (restoringRef.current || current.current?.key === key) {
      // Restore landing, or a state change invisible to the key: refresh the
      // stored snapshot without recording an entry.
      current.current = { key, snap: snapshot };
      return;
    }
    if (current.current) {
      past.current.push(current.current);
      if (past.current.length > MAX_ENTRIES) past.current.shift();
      future.current = [];
    }
    current.current = { key, snap: snapshot };
    bump();
  }, [key, snapshot, restoringRef]);

  const go = (from: Entry<T>[], to: Entry<T>[]) => {
    const entry = from.pop();
    if (!entry) return;
    if (current.current) to.push(current.current);
    current.current = entry;
    restoringRef.current = true;
    onRestore(entry.snap);
    bump();
  };

  return {
    canGoBack: past.current.length > 0,
    canGoForward: future.current.length > 0,
    goBack: () => go(past.current, future.current),
    goForward: () => go(future.current, past.current),
  };
}
