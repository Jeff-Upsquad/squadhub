import { useState } from 'react';
import type { Task, SpaceStatus, ListViewColumnId } from '@squadhub/shared';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import { useCreateTask } from '../../../hooks/useTasks';
import { isTaskCompleted, isTaskFocused } from '../../../lib/taskGrouping';
import { COLUMN_DEFS, DEFAULT_VISIBLE_IDS, gridTemplateFor, type ColumnControls } from '../../../lib/columns';
import TaskRow from './TaskRow';

const DEFAULT_VISIBLE_COLUMNS: ListViewColumnId[] = DEFAULT_VISIBLE_IDS;

interface TaskGroupCardProps {
  groupKey: string;
  label: string;
  dotColor?: string;
  tasks: Task[];
  allStatuses: SpaceStatus[];
  listId: string | null;
  onStatusChange: (taskId: string, statusId: string) => void;
  canEdit?: boolean;
  showAddRow?: boolean;
  defaultNewTaskStatus?: string;
  onDrop?: (taskId: string, statusId: string) => void;
  defaultCollapsed?: boolean;
  /** 'focus' renders the elevated amber "Focus Today" spotlight treatment. */
  variant?: 'default' | 'focus';
  /** Fade focused (but not completed) rows — signals they're already in the Focus Today banner above. */
  dimFocused?: boolean;
  defaultPriority?: string | null;
  defaultTaskTypeId?: string | null;
  defaultLabelId?: string | null;
  activeViewId?: string | null;
  /** Visible field columns in display order. Defaults to priority → assignee → work → due. */
  columns?: ListViewColumnId[];
  /** Full field controls (enables the header "+" field manager). */
  columnControls?: ColumnControls;
}

export default function TaskGroupCard({
  groupKey,
  label,
  dotColor,
  tasks,
  allStatuses,
  listId,
  onStatusChange,
  canEdit = true,
  showAddRow = false,
  defaultNewTaskStatus,
  onDrop,
  defaultCollapsed = false,
  variant = 'default',
  dimFocused = false,
  defaultPriority,
  defaultTaskTypeId,
  defaultLabelId,
  activeViewId,
  columns,
  columnControls,
}: TaskGroupCardProps) {
  const visibleColumns: ListViewColumnId[] = columns ?? DEFAULT_VISIBLE_COLUMNS;
  const headGridStyle = { gridTemplateColumns: gridTemplateFor(visibleColumns) };
  const labelFor = (id: ListViewColumnId) => COLUMN_DEFS.find((d) => d.id === id)?.label ?? id;
  // Header "+" slot: opens the same field manager as the toolbar Fields
  // button. Falls back to the visible ids when no full controls are passed.
  const renderHeaderAdd = () => {
    const open = columnControls?.onOpenManager;
    if (!open) return <span />;
    return (
      <span style={{ display: 'inline-flex', justifyContent: 'center' }}>
        <button
          type="button"
          className="lv-col-add"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          title="Add / manage fields in this view"
          aria-label="Add / manage fields in this view"
          aria-haspopup="dialog"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </span>
    );
  };
  const isFocus = variant === 'focus';
  const { collapsedGroups, setGroupCollapsed } = usePMStore();
  const isCollapsed = collapsedGroups[groupKey] ?? defaultCollapsed;
  // Toggle from the *effective* state so the first click always works, even
  // when the stored value is still undefined (e.g. a defaultCollapsed group).
  const toggleCollapse = () => setGroupCollapsed(groupKey, !isCollapsed);
  const [isDragOver, setIsDragOver] = useState(false);
  const [addTitle, setAddTitle] = useState<string | null>(null);
  const createTask = useCreateTask(listId);

  const completedCount = tasks.filter(isTaskCompleted).length;
  const totalCount = tasks.length;
  const pct = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

  // Focus banner (D2 "agenda") — live date eyebrow + donut progress ring.
  const RING_C = 2 * Math.PI * 15;
  const ringOffset = RING_C * (1 - pct / 100);
  const focusDateLabel = isFocus
    ? `${new Date().toLocaleDateString(undefined, { weekday: 'long' })} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : '';

  const handleDragOver = (e: React.DragEvent) => {
    if (!onDrop) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId && onDrop) onDrop(taskId, defaultNewTaskStatus || groupKey);
  };

  return (
    <div
      className={isFocus ? 'lv-card lv-card--focus' : 'lv-card'}
      data-dragover={isDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Group header — focus renders the editorial "agenda" banner plus the
          same column headings as every other group, so Priority / Assignee /
          Work date / Due line up with the rows below. */}
      {isFocus ? (
        <>
          <div
            className="lv-card-head lv-focus-head"
            onClick={toggleCollapse}
          >
          <div className="lv-focus-lead">
            <span className="gh-chevron">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                style={{
                  transform: isCollapsed ? 'none' : 'rotate(90deg)',
                  transition: 'transform 0.15s',
                }}
              >
                <path d="M9 5l7 7-7 7" />
              </svg>
            </span>
            <span className="lv-focus-badge" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </span>
            <div className="lv-focus-heading">
              <span className="lv-focus-eyebrow">{focusDateLabel}</span>
              <span className="lv-focus-title">{label}</span>
            </div>
          </div>
          <div className="lv-focus-meta">
            <span className="lv-focus-done">
              {completedCount} of {totalCount} done
            </span>
            <span className="lv-focus-ring">
              <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
                <circle className="lv-ring-track" cx="19" cy="19" r="15" fill="none" strokeWidth="4" />
                <circle
                  cx="19"
                  cy="19"
                  r="15"
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={RING_C}
                  strokeDashoffset={ringOffset}
                  transform="rotate(-90 19 19)"
                  style={{ transition: 'stroke-dashoffset 0.4s' }}
                />
              </svg>
              <span className="lv-focus-ring-label">{pct}%</span>
            </span>
          </div>
          </div>
          {!isCollapsed && (
            <div
              className="lv-card-head lv-focus-cols"
              aria-hidden="true"
              style={headGridStyle}
            >
              <div className="gh-left" />
              {visibleColumns.map((id) => (
                <span key={id} className="gh-col">{labelFor(id)}</span>
              ))}
              {renderHeaderAdd()}
            </div>
          )}
        </>
      ) : (
        <div
          className="lv-card-head"
          onClick={toggleCollapse}
          style={headGridStyle}
        >
          <div className="gh-left">
            <span className="gh-chevron">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                style={{
                  transform: isCollapsed ? 'none' : 'rotate(90deg)',
                  transition: 'transform 0.15s',
                }}
              >
                <path d="M9 5l7 7-7 7" />
              </svg>
            </span>
            {dotColor && (
              <span
                className="lv-glyph-dot"
                style={{
                  background: dotColor,
                  boxShadow: `0 0 0 3px ${dotColor}22`,
                }}
              />
            )}
            <span className="gh-title">{label}</span>
            <span className="lv-progress">
              <span
                className="lv-progress-fill"
                style={{
                  width: `${pct}%`,
                  background: dotColor || 'var(--sh-ink-3)',
                }}
              />
            </span>
            <span className="lv-fraction">
              {completedCount}/{totalCount}
            </span>
          </div>
          {visibleColumns.map((id) => (
            <span key={id} className="gh-col">{labelFor(id)}</span>
          ))}
          {renderHeaderAdd()}
        </div>
      )}

      {/* Task rows */}
      {!isCollapsed && (
        <div className="lv-card-body">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              statuses={allStatuses}
              onStatusChange={onStatusChange}
              canEdit={canEdit}
              listId={listId || (task as any).list_id || task.list?.id || ''}
              dimmed={dimFocused && !isFocus && isTaskFocused(task) && !isTaskCompleted(task)}
              columns={visibleColumns}
            />
          ))}

          {/* Inline add-task */}
          {showAddRow && canEdit && listId && (
            addTitle !== null ? (
              <div className="lv-add">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <input
                  autoFocus
                  value={addTitle}
                  placeholder="Task title, Enter to add · Esc to cancel"
                  onChange={(e) => setAddTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = addTitle.trim();
                      if (val) {
                        createTask.mutate(
                          {
                            title: val,
                            status: defaultNewTaskStatus || 'todo',
                            list_id: listId,
                            priority: defaultPriority && defaultPriority !== 'none' ? (defaultPriority as any) : undefined,
                            task_type_id: defaultTaskTypeId || undefined,
                            metadata: activeViewId ? { view_id: activeViewId } : undefined,
                            tag_id: defaultLabelId,
                          },
                          {
                            onSuccess: async (created) => {
                              setAddTitle('');
                              if (defaultLabelId && created?.id) {
                                try {
                                  await api.post(`/pm/labels/tasks/${created.id}/labels`, { tag_id: defaultLabelId });
                                } catch (err) {
                                  // Ignore if already attached by create payload
                                }
                              }
                            },
                          },
                        );
                      } else setAddTitle(null);
                    } else if (e.key === 'Escape') {
                      e.stopPropagation();
                      setAddTitle(null);
                    }
                  }}
                  onBlur={() => {
                    const val = addTitle.trim();
                    if (val) {
                      createTask.mutate(
                        {
                          title: val,
                          status: defaultNewTaskStatus || 'todo',
                          list_id: listId,
                          priority: defaultPriority && defaultPriority !== 'none' ? (defaultPriority as any) : undefined,
                          task_type_id: defaultTaskTypeId || undefined,
                          metadata: activeViewId ? { view_id: activeViewId } : undefined,
                          tag_id: defaultLabelId,
                        },
                        {
                          onSuccess: async (created) => {
                            setAddTitle(null);
                            if (defaultLabelId && created?.id) {
                              try {
                                await api.post(`/pm/labels/tasks/${created.id}/labels`, { tag_id: defaultLabelId });
                              } catch (err) {
                                // Ignore if already attached by create payload
                              }
                            }
                          },
                        },
                      );
                    } else setAddTitle(null);
                  }}
                />
              </div>
            ) : (
              <div className="lv-add" onClick={() => setAddTitle('')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>Add task</span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
