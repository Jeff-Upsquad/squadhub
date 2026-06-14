import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAuthStore } from './stores/authStore';
import { fetchPersonalList, createTask } from './services/api';

// Cached across summons of the (persistent) quickadd window so we only resolve
// the personal list once per app run.
let cachedListId: string | null = null;

type Phase = 'idle' | 'saving' | 'done' | 'error';

export default function QuickAdd() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const win = getCurrentWindow();

  const reset = () => {
    setTitle('');
    setPhase('idle');
    setError('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    // The quickadd webview is its own JS context — hydrate auth from the shared
    // store file (auth.json) so we have the latest tokens / userId.
    useAuthStore.getState().hydrate();
    reset();

    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        // Re-hydrate in case the user (re)logged in via the main window, and
        // clear the field each time the window is summoned.
        useAuthStore.getState().hydrate();
        reset();
      } else {
        // Spotlight behaviour: dismiss when focus is lost.
        void win.hide();
      }
    });

    return () => { void unlisten.then((fn) => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || phase === 'saving') return;

    if (!useAuthStore.getState().accessToken) {
      setPhase('error');
      setError('Sign in from the SquadHub menu-bar app first.');
      return;
    }

    setPhase('saving');
    setError('');
    try {
      if (!cachedListId) {
        const personal = await fetchPersonalList();
        cachedListId = personal.list.id;
      }
      await createTask(cachedListId, trimmed);
      setPhase('done');
      setTitle('');
      setTimeout(() => { void win.hide(); }, 550);
    } catch (e) {
      // A stale cached id (e.g. list deleted) — clear so the next try re-resolves.
      cachedListId = null;
      setPhase('error');
      setError(e instanceof Error ? e.message : 'Could not add task');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      void win.hide();
    }
  };

  return (
    <div className="qa">
      <div className="qa-row">
        <span className="qa-icon">+</span>
        <input
          ref={inputRef}
          className="qa-input"
          placeholder="Add a task to My Tasks…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
          disabled={phase === 'saving'}
        />
      </div>
      <div className="qa-hint">
        {phase === 'saving' && <span>Adding…</span>}
        {phase === 'done' && <span className="qa-ok">Added ✓</span>}
        {phase === 'error' && <span className="qa-err">{error}</span>}
        {phase === 'idle' && (
          <span>
            <b>Enter</b> to add · <b>Esc</b> to dismiss · saved privately to your My Tasks
          </span>
        )}
      </div>
    </div>
  );
}
