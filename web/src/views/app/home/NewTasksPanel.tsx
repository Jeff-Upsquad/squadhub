import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePMStore } from '../../../stores/pmStore';
import { useNewTasks } from '../../../hooks/useNewTasks';
import NewTaskRow from './NewTaskRow';

// The full-page "New Tasks" review popup. Distinct from DashboardListPanel (which
// slides in from the right) — this is a centered full-screen overlay. Portaled to
// <body> and kept transform-free so the field pickers' fixed positioning stays
// anchored to the viewport.
export default function NewTasksPanel() {
  const open = usePMStore((s) => s.newTasksOpen);
  const setOpen = usePMStore((s) => s.setNewTasksOpen);
  const [mounted, setMounted] = useState(false);
  const [showReviewed, setShowReviewed] = useState(false);

  const { data, isLoading } = useNewTasks({ includeReviewed: showReviewed, enabled: open });
  const tasks = data || [];
  const reviewedCount = showReviewed ? tasks.filter((t) => t.reviewed).length : 0;

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }
    setMounted(false);
    setShowReviewed(false);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A task detail panel opened from a row sits on top — let it take Escape first
      // so closing the task doesn't also close this popup.
      if (usePMStore.getState().activeTaskId) return;
      // Don't swallow Escape meant for an open picker's search box.
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open || typeof document === 'undefined') return null;

  const count = tasks.length;

  return createPortal(
    <div className="nt-overlay" data-mounted={mounted || undefined}>
      <div className="nt-backdrop" onClick={() => setOpen(false)} />
      <div className="nt-modal" role="dialog" aria-modal="true" aria-label="New Tasks">
        <div className="nt-head">
          <div className="nt-head-text">
            <div className="nt-eyebrow">Review queue</div>
            <h2 className="nt-h">New Tasks</h2>
            <div className="nt-sub">
              {isLoading
                ? 'Loading…'
                : count === 0
                  ? showReviewed ? 'No reviewed tasks yet.' : 'You’re all caught up.'
                  : `${count} ${count === 1 ? 'task' : 'tasks'} ${showReviewed ? 'in your queue' : 'to review'}`}
            </div>
          </div>
          <div className="nt-head-actions">
            <button
              type="button"
              className="nt-toggle"
              data-active={showReviewed || undefined}
              onClick={() => setShowReviewed((v) => !v)}
              title="Include tasks you've already reviewed"
            >
              {showReviewed ? 'Hide reviewed' : 'Show reviewed'}
            </button>
            <kbd className="nt-kbd" title="Press Escape to close">esc</kbd>
            <button type="button" className="nt-close" onClick={() => setOpen(false)} title="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="nt-scroll">
          <div className="nt-table">
            <div className="nt-head-row">
              <div className="nt-col nt-c-review">Review</div>
              <div className="nt-col nt-c-task">Task</div>
              <div className="nt-col nt-c-assignee">Assignee</div>
              <div className="nt-col nt-c-priority">Priority</div>
              <div className="nt-col nt-c-status">Status</div>
              <div className="nt-col nt-c-estimate">Estimate</div>
              <div className="nt-col nt-c-date">Work date</div>
              <div className="nt-col nt-c-date">Start date</div>
              <div className="nt-col nt-c-date">Due date</div>
            </div>

            {isLoading ? (
              <div className="nt-skel-wrap" aria-hidden="true">
                <div className="nt-skel" />
                <div className="nt-skel" style={{ animationDelay: '0.12s' }} />
                <div className="nt-skel" style={{ animationDelay: '0.24s' }} />
              </div>
            ) : count === 0 ? (
              <div className="nt-empty">
                <div className="rule" />
                <div className="h">{showReviewed ? 'No reviewed tasks' : 'All caught up'}</div>
                <div className="p">
                  {showReviewed
                    ? 'Tasks you tick as reviewed appear here so you can undo.'
                    : 'New tasks assigned to you — and tasks you created but haven’t assigned yet — land here for review.'}
                </div>
              </div>
            ) : (
              tasks.map((task) => (
                <NewTaskRow key={task.id} task={task} showReviewed={showReviewed} />
              ))
            )}
          </div>
        </div>

        {showReviewed && reviewedCount > 0 && (
          <div className="nt-foot">{reviewedCount} reviewed — untick to restore to your queue</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
