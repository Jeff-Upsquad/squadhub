import { useState } from 'react';
import { usePMStore } from '../../../stores/pmStore';
import { useTask, useUpdateTask, useDeleteTask, useTaskComments, useAddComment } from '../../../hooks/useTasks';
import type { SpaceStatus } from '@squadhub/shared';
import TaskPriorityBadge from './TaskPriorityBadge';

export default function TaskDetailPanel({
  statuses,
  listId,
}: {
  statuses: SpaceStatus[];
  listId: string;
}) {
  const { activeTaskId, setActiveTask } = usePMStore();
  const { data: task, isLoading } = useTask(activeTaskId);
  const { data: comments } = useTaskComments(activeTaskId);
  const updateTask = useUpdateTask(listId);
  const deleteTask = useDeleteTask(listId);
  const addComment = useAddComment(activeTaskId);

  const [editing, setEditing] = useState<'title' | 'description' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [commentText, setCommentText] = useState('');

  if (!activeTaskId) return null;

  if (isLoading || !task) {
    return (
      <div className="flex w-96 items-center justify-center border-l border-gray-800 bg-gray-900/50">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  const status = statuses.find((s) => s.id === task.status_id);

  const handleSave = (field: 'title' | 'description') => {
    if (field === 'title' && editValue.trim()) {
      updateTask.mutate({ id: task.id, title: editValue.trim() });
    } else if (field === 'description') {
      updateTask.mutate({ id: task.id, description: editValue.trim() || null });
    }
    setEditing(null);
  };

  const handleDelete = () => {
    deleteTask.mutate(task.id, {
      onSuccess: () => setActiveTask(null),
    });
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    addComment.mutate(commentText.trim(), {
      onSuccess: () => setCommentText(''),
    });
  };

  return (
    <div className="flex w-96 shrink-0 flex-col border-l border-gray-800 bg-gray-900/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <span className="text-xs font-medium text-gray-500">Task Detail</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDelete}
            className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-red-400"
            title="Delete task"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={() => setActiveTask(null)}
            className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Title */}
        {editing === 'title' ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave('title'); if (e.key === 'Escape') setEditing(null); }}
            onBlur={() => handleSave('title')}
            className="mb-3 w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-base font-semibold text-white outline-none focus:border-brand-500"
          />
        ) : (
          <h3
            onClick={() => { setEditing('title'); setEditValue(task.title); }}
            className="mb-3 cursor-pointer text-base font-semibold text-white hover:text-gray-300"
          >
            {task.title}
          </h3>
        )}

        {/* Properties */}
        <div className="mb-4 space-y-3">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Status</span>
            <select
              value={task.status_id}
              onChange={(e) => updateTask.mutate({ id: task.id, status_id: e.target.value })}
              className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-white outline-none"
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Priority</span>
            <select
              value={task.priority}
              onChange={(e) => updateTask.mutate({ id: task.id, priority: e.target.value as any })}
              className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-white outline-none"
            >
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          {/* Due date */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Due date</span>
            <input
              type="date"
              value={task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : ''}
              onChange={(e) => updateTask.mutate({ id: task.id, due_date: e.target.value || null })}
              className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-white outline-none"
            />
          </div>

          {/* Assignees */}
          {task.assignees && task.assignees.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Assignees</span>
              <div className="flex -space-x-1">
                {task.assignees.map((u: any) => (
                  <div
                    key={u.id}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-700 text-[10px] font-medium text-gray-300 ring-1 ring-gray-900"
                    title={u.display_name || u.email}
                  >
                    {(u.display_name || u.email)?.[0]?.toUpperCase()}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="mb-4">
          <span className="mb-1 block text-xs text-gray-500">Description</span>
          {editing === 'description' ? (
            <textarea
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleSave('description')}
              rows={4}
              className="w-full resize-none rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white outline-none focus:border-brand-500"
            />
          ) : (
            <div
              onClick={() => { setEditing('description'); setEditValue(task.description || ''); }}
              className="min-h-[60px] cursor-pointer rounded border border-transparent p-2 text-sm text-gray-300 hover:border-gray-700 hover:bg-gray-800/50"
            >
              {task.description || <span className="text-gray-600">Add a description...</span>}
            </div>
          )}
        </div>

        {/* Subtasks */}
        {task.subtasks && task.subtasks.length > 0 && (
          <div className="mb-4">
            <span className="mb-1 block text-xs text-gray-500">Subtasks ({task.subtasks.length})</span>
            {task.subtasks.map((sub: any) => (
              <div key={sub.id} className="flex items-center gap-2 py-1 text-sm text-gray-400">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: statuses.find((s) => s.id === sub.status_id)?.color || '#6b7280' }}
                />
                {sub.title}
              </div>
            ))}
          </div>
        )}

        {/* Comments */}
        <div>
          <span className="mb-2 block text-xs text-gray-500">
            Comments {task.comment_count ? `(${task.comment_count})` : ''}
          </span>

          {comments?.map((c) => (
            <div key={c.id} className="mb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-[10px] font-medium text-gray-300">
                  {(c.user?.display_name || c.user?.email)?.[0]?.toUpperCase()}
                </div>
                <span className="text-xs font-medium text-gray-300">{c.user?.display_name || c.user?.email}</span>
                <span className="text-[10px] text-gray-600">
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1 pl-7 text-sm text-gray-400">{c.content}</p>
            </div>
          ))}

          {/* Add comment */}
          <div className="mt-3 flex gap-2">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(); }}
              placeholder="Write a comment..."
              className="flex-1 rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-brand-500"
            />
            <button
              onClick={handleAddComment}
              disabled={!commentText.trim() || addComment.isPending}
              className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
