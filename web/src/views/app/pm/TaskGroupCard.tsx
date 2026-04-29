import { useState } from 'react';
import type { Task, SpaceStatus } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useCreateTask } from '../../../hooks/useTasks';
import { isTaskCompleted } from '../../../lib/taskGrouping';
import TaskRow from './TaskRow';

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
}: TaskGroupCardProps) {
  const { collapsedGroups, toggleGroupCollapse } = usePMStore();
  const isCollapsed = collapsedGroups[groupKey] ?? defaultCollapsed;
  const [isDragOver, setIsDragOver] = useState(false);
  const [addTitle, setAddTitle] = useState<string | null>(null);
  const createTask = useCreateTask(listId);

  const completedCount = tasks.filter(isTaskCompleted).length;
  const totalCount = tasks.length;
  const pct = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

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
      className="lv-card"
      data-dragover={isDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Group header */}
      <div
        className="lv-card-head"
        onClick={() => toggleGroupCollapse(groupKey)}
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
        <span className="gh-col">Assignee</span>
        <span className="gh-col">Work date</span>
        <span className="gh-col">Due</span>
        <span />
      </div>

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
                          { title: val, status: defaultNewTaskStatus || 'todo', list_id: listId },
                          { onSuccess: () => setAddTitle('') },
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
                        { title: val, status: defaultNewTaskStatus || 'todo', list_id: listId },
                        { onSuccess: () => setAddTitle(null) },
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
