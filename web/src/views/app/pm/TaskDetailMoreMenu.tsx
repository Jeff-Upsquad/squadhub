import React, { useEffect, useState } from 'react';
import GoalIcon from '../goals/GoalIcons';
import { useGoalActions, useTaskGoals } from '../goals/goalsApi';

interface TaskDetailMoreMenuProps {
  open: boolean;
  onClose: () => void;
  canEdit?: boolean;
  workspaceId?: string | null;
  taskId?: string;
  onMoveToList?: () => void;
  onAddToList?: () => void;
  onDelete?: () => void;
  onAddToGoal?: () => void;
  onRelationships?: () => void;
  onReportSop?: () => void;
}

/**
 * Animated three-dots menu for TaskDetailPanel.
 * Supports smooth entry and exit animations, SquadHub typography system,
 * accessible keyboard dismiss (Escape), and theme-aware glass/solid surfaces.
 */
export default function TaskDetailMoreMenu({
  open,
  onClose,
  canEdit = false,
  workspaceId,
  taskId,
  onMoveToList,
  onAddToList,
  onDelete,
  onAddToGoal,
  onRelationships,
  onReportSop,
}: TaskDetailMoreMenuProps) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<'closed' | 'open'>(open ? 'open' : 'closed');
  const taskGoals = useTaskGoals(taskId);
  const actions = useGoalActions();
  const directGoals = taskGoals.filter((g) => g.tasks.some((t) => t.id === taskId && t.direct));

  // Handle open / close animation timing
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => {
        setState('open');
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setState('closed');
      timer = setTimeout(() => {
        setMounted(false);
      }, 160);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Dismiss on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <>
      {/* Invisible backdrop catching outside clicks */}
      <div
        className={`td-more-menu-backdrop ${state === 'open' ? 'is-open' : ''}`}
        aria-hidden="true"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />

      {/* Floating menu card */}
      <div
        role="menu"
        aria-orientation="vertical"
        data-state={state}
        className="sh-float td-more-menu-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {canEdit && !!workspaceId && onMoveToList && (
          <button
            type="button"
            role="menuitem"
            className="td-more-menu-item group"
            onClick={() => {
              onClose();
              onMoveToList();
            }}
          >
            <span className="td-item-icon">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M13 4H6.5A2.5 2.5 0 004 6.5v11A2.5 2.5 0 006.5 20H13" />
                <path d="M9.5 12H20M16.5 8.5 20 12l-3.5 3.5" />
              </svg>
            </span>
            <span>Move to another list</span>
          </button>
        )}

        {canEdit && !!workspaceId && onAddToList && (
          <button
            type="button"
            role="menuitem"
            className="td-more-menu-item group"
            onClick={() => {
              onClose();
              onAddToList();
            }}
          >
            <span className="td-item-icon">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                <line x1="19" y1="3" x2="19" y2="9" />
                <line x1="16" y1="6" x2="22" y2="6" />
              </svg>
            </span>
            <span>Add to list</span>
          </button>
        )}

        {!!taskId && onAddToGoal && (
          <button
            type="button"
            role="menuitem"
            className="td-more-menu-item group"
            onClick={() => {
              onClose();
              onAddToGoal();
            }}
          >
            <span className="td-item-icon">
              <GoalIcon name="flag" size={14} />
            </span>
            <span>Add to a goal</span>
          </button>
        )}

        {!!taskId && onRelationships && (
          <button
            type="button"
            role="menuitem"
            className="td-more-menu-item group"
            onClick={() => {
              onClose();
              onRelationships();
            }}
          >
            <span className="td-item-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </span>
            <span>Relationships</span>
          </button>
        )}

        {/* One entry per goal this task was linked to directly. Auto-included
            tasks (via a connected folder/list) can't be unlinked one by one. */}
        {directGoals.map((g) => (
          <button
            key={g.id}
            type="button"
            role="menuitem"
            className="td-more-menu-item group"
            title={`Remove from “${g.name}”`}
            onClick={() => {
              onClose();
              const link = g.tasks.find((t) => t.id === taskId);
              if (link) void actions.unlinkTask(g.id, link).catch(() => undefined);
            }}
          >
            <span className="td-item-icon">
              <GoalIcon name="unlink" size={14} />
            </span>
            <span className="truncate">
              {directGoals.length === 1 ? 'Remove from goal' : `Remove from “${g.name}”`}
            </span>
          </button>
        ))}

        {/* Action divider */}
        <div className="td-more-menu-sep" role="separator" />

        {onReportSop && (
          <button
            type="button"
            role="menuitem"
            className="td-more-menu-item is-danger group"
            onClick={() => {
              onClose();
              onReportSop();
            }}
          >
            <span className="td-item-icon">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
            </span>
            <span>Report SOP breach</span>
          </button>
        )}

        {canEdit && onDelete && (
          <button
            type="button"
            role="menuitem"
            className="td-more-menu-item is-danger group"
            onClick={() => {
              onClose();
              onDelete();
            }}
          >
            <span className="td-item-icon">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </span>
            <span>Delete task</span>
          </button>
        )}
      </div>
    </>
  );
}
