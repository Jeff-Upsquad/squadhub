'use client';

import { useEffect, useState } from 'react';
import { useMeetingPanelStore } from '../stores/meetingPanelStore';
import { usePMStore } from '../stores/pmStore';

/**
 * Small global quick-create FAB — a 36px circular "+" pinned to the
 * bottom-right corner above every desktop screen. Opens the same two
 * options as the old per-view create menu (New Task / Schedule meeting)
 * but in a smaller, less intruding footprint.
 */
export default function GlobalQuickCreateFab({
  onNewTask,
}: {
  onNewTask: () => void;
}) {
  const [open, setOpen] = useState(false);
  const openMeetingPanel = useMeetingPanelStore((s) => s.openMeetingPanel);
  const activeListId = usePMStore((s) => s.activeListId);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handleNewTask = () => {
    setOpen(false);
    onNewTask();
  };

  const handleNewMeeting = () => {
    setOpen(false);
    openMeetingPanel(activeListId ? { listId: activeListId } : {});
  };

  return (
    <div className="sh-quickcreate-wrap">
      {open && (
        <>
          <div
            className="sh-quickcreate-backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="sh-quickcreate-menu" role="menu">
            <button
              type="button"
              onClick={handleNewTask}
              className="sh-quickcreate-item"
              role="menuitem"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M9 11l3 3 8-8M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" /></svg>
              New Task
            </button>
            <button
              type="button"
              onClick={handleNewMeeting}
              className="sh-quickcreate-item"
              role="menuitem"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a7d55" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              Create New Meeting
            </button>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="sh-quickcreate-fab"
        aria-label={open ? 'Close quick create' : 'Quick create'}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Create task or meeting"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          className={`sh-quickcreate-plus${open ? ' is-open' : ''}`}
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
