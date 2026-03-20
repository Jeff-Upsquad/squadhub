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
      <div className="flex w-96 items-center justify-center border-l border-[#E2E8F0] bg-[#F1F5F9]/60">
        <p className="text-sm text-[#999999]">Loading...</p>
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
    <div className="flex w-96 shrink-0 flex-col border-l border-[#E2E8F0] bg-[#F1F5F9]/60">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-3">
        <span className="text-xs font-medium text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Task Detail</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDelete}
            className="rounded p-1 text-[#999999] hover:bg-[#F8FAFC] hover:text-red-500"
            title="Delete task"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={() => setActiveTask(null)}
            className="rounded p-1 text-[#999999] hover:bg-[#F8FAFC] hover:text-[#0F172B]"
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
            className="mb-3 w-full rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-1 text-base font-semibold text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
          />
        ) : (
          <h3
            onClick={() => { setEditing('title'); setEditValue(task.title); }}
            className="mb-3 cursor-pointer text-base font-semibold text-[#0F172B] font-[family-name:var(--font-display)] hover:text-[#0F172B]"
          >
            {task.title}
          </h3>
        )}

        {/* Properties */}
        <div className="mb-4 space-y-3">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Status</span>
            <select
              value={task.status_id}
              onChange={(e) => updateTask.mutate({ id: task.id, status_id: e.target.value })}
              className="rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Priority</span>
            <select
              value={task.priority}
              onChange={(e) => updateTask.mutate({ id: task.id, priority: e.target.value as any })}
              className="rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
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
            <span className="text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Due date</span>
            <input
              type="date"
              value={task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : ''}
              onChange={(e) => updateTask.mutate({ id: task.id, due_date: e.target.value || null })}
              className="rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            />
          </div>

          {/* Assignees */}
          {task.assignees && task.assignees.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Assignees</span>
              <div className="flex -space-x-1">
                {task.assignees.map((u: any) => (
                  <div
                    key={u.id}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B] ring-1 ring-white"
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
          <span className="mb-1 block text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Description</span>
          {editing === 'description' ? (
            <textarea
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleSave('description')}
              rows={4}
              className="w-full resize-none rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-1.5 text-sm text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            />
          ) : (
            <div
              onClick={() => { setEditing('description'); setEditValue(task.description || ''); }}
              className="min-h-[60px] cursor-pointer rounded border border-transparent p-2 text-sm text-[#0F172B] hover:border-[#CAD5E2] hover:bg-[#F8FAFC]/50"
            >
              {task.description || <span className="text-[#999999]">Add a description...</span>}
            </div>
          )}
        </div>

        {/* Subtasks */}
        {task.subtasks && task.subtasks.length > 0 && (
          <div className="mb-4">
            <span className="mb-1 block text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Subtasks ({task.subtasks.length})</span>
            {task.subtasks.map((sub: any) => (
              <div key={sub.id} className="flex items-center gap-2 py-1 text-sm text-[#666666]">
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
          <span className="mb-2 block text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">
            Comments {task.comment_count ? `(${task.comment_count})` : ''}
          </span>

          {comments?.map((c) => (
            <div key={c.id} className="mb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B]">
                  {(c.user?.display_name || c.user?.email)?.[0]?.toUpperCase()}
                </div>
                <span className="text-xs font-medium text-[#0F172B]">{c.user?.display_name || c.user?.email}</span>
                <span className="text-[10px] text-[#999999]">
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1 pl-7 text-sm text-[#666666]">{c.content}</p>
            </div>
          ))}

          {/* Add comment */}
          <div className="mt-3 flex gap-2">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(); }}
              placeholder="Write a comment..."
              className="flex-1 rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2.5 py-1.5 text-sm text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            />
            <button
              onClick={handleAddComment}
              disabled={!commentText.trim() || addComment.isPending}
              className="rounded bg-[#0F172B] text-white px-3 py-1.5 text-xs font-medium hover:bg-[#1D293D] disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
