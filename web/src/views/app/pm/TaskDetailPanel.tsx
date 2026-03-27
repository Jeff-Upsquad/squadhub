import { useState } from 'react';
import { usePMStore } from '../../../stores/pmStore';
import { useTask, useUpdateTask, useDeleteTask, useTaskComments, useAddComment } from '../../../hooks/useTasks';
import type { SpaceStatus } from '@squadhub/shared';
import TaskPriorityBadge from './TaskPriorityBadge';
import TaskStatusBadge from './TaskStatusBadge';

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
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showFields, setShowFields] = useState(true);
  const [subtaskTab, setSubtaskTab] = useState<'open' | 'closed' | 'archived'>('open');

  if (!activeTaskId) return null;

  if (isLoading || !task) {
    return (
      <div className="flex w-[720px] items-center justify-center border-l border-[#E2E8F0] bg-white">
        <p className="text-sm text-[#999999]">Loading...</p>
      </div>
    );
  }

  const status = statuses.find((s) => s.category === (task as any).status);

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
    <div className="flex w-[720px] shrink-0 flex-col border-l border-[#E2E8F0] bg-white">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Task type selector */}
          <div className="flex items-center gap-1 rounded border border-[#E2E8F0] px-2 py-1 text-xs text-[#666666]">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Task
            <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {/* Dependency icon */}
          {task.subtasks && task.subtasks.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-[#999999]">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.172 13.828a4 4 0 015.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
              </svg>
              {task.subtasks.length}
            </span>
          )}

          {/* For me badge */}
          <span className="flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-600 ring-1 ring-orange-200">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            1 for me
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleDelete}
            className="rounded p-1.5 text-[#999999] hover:bg-[#F1F5F9] hover:text-red-500"
            title="Delete task"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={() => setActiveTask(null)}
            className="rounded p-1.5 text-[#999999] hover:bg-[#F1F5F9] hover:text-[#0F172B]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main content: left sidebar + center + right activity */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left mini-sidebar: subtasks */}
        <div className="flex w-52 shrink-0 flex-col border-r border-[#E2E8F0] bg-[#FAFBFC]">
          {/* Subtask tabs */}
          <div className="flex border-b border-[#E2E8F0] px-2 py-1.5">
            {(['open', 'closed', 'archived'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSubtaskTab(tab)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium capitalize transition ${
                  subtaskTab === tab
                    ? 'bg-white text-[#0F172B] shadow-sm'
                    : 'text-[#999999] hover:text-[#666666]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {/* Parent task */}
            <div className="mb-2 rounded bg-emerald-50 px-2 py-1.5">
              <p className="text-xs font-medium text-[#0F172B] leading-tight">{task.title}</p>
            </div>

            {/* Subtasks */}
            {task.subtasks && task.subtasks.length > 0 ? (
              task.subtasks.map((sub: any) => (
                <div
                  key={sub.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-[#666666] transition hover:bg-white"
                  onClick={() => setActiveTask(sub.id)}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: statuses.find((s) => s.category === (sub as any).status)?.color || '#6b7280' }}
                  />
                  <span className="truncate">{sub.title}</span>
                </div>
              ))
            ) : (
              <p className="px-2 text-[10px] text-[#CAD5E2]">No subtasks</p>
            )}

            {/* Add subtask */}
            <button className="mt-2 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-[#999999] transition hover:bg-white hover:text-[#0F172B]">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Subtask
            </button>
          </div>
        </div>

        {/* Center content */}
        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="flex-1 p-5">
            {/* Title */}
            {editing === 'title' ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave('title'); if (e.key === 'Escape') setEditing(null); }}
                onBlur={() => handleSave('title')}
                className="mb-3 w-full rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-1.5 text-lg font-semibold text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF] font-[family-name:var(--font-display)]"
              />
            ) : (
              <h2
                onClick={() => { setEditing('title'); setEditValue(task.title); }}
                className="mb-3 cursor-pointer text-lg font-semibold text-[#0F172B] font-[family-name:var(--font-display)] hover:text-[#0F172B]/80"
              >
                {task.title}
              </h2>
            )}

            {/* AI prompt bar */}
            <div className="mb-5 flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] px-3 py-2">
              <svg className="h-4 w-4 shrink-0 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="text-xs text-[#999999]">
                Ask Brain to <span className="font-medium text-[#666666] underline decoration-dotted">write a description</span>, <span className="font-medium text-[#666666] underline decoration-dotted">create a summary</span> or <span className="font-medium text-[#666666] underline decoration-dotted">find similar tasks</span>
              </span>
            </div>

            {/* Properties */}
            <div className="mb-5 space-y-0 divide-y divide-[#E2E8F0]/50">
              {/* Status */}
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#999999]">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Status
                </div>
                <div className="flex items-center gap-2">
                  <TaskStatusBadge status={status} />
                  <select
                    value={(task as any).status}
                    onChange={(e) => updateTask.mutate({ id: task.id, status: e.target.value })}
                    className="h-0 w-0 opacity-0"
                    id="status-select"
                  >
                    {statuses.map((s) => (
                      <option key={s.id} value={s.category}>{s.name}</option>
                    ))}
                  </select>
                  <label
                    htmlFor="status-select"
                    className="cursor-pointer rounded p-0.5 text-[#999999] hover:bg-[#F1F5F9] hover:text-[#0F172B]"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </label>
                </div>
              </div>

              {/* Assignees */}
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#999999]">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Assignees
                </div>
                <div className="flex items-center gap-1.5">
                  {task.assignees && task.assignees.length > 0 ? (
                    task.assignees.map((u: any) => (
                      <div key={u.id} className="flex items-center gap-1.5">
                        <div
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B] ring-1 ring-white"
                        >
                          {(u.display_name || u.email)?.[0]?.toUpperCase()}
                        </div>
                        <span className="text-xs text-[#0F172B]">{u.display_name || u.email}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-xs text-[#CAD5E2]">Empty</span>
                  )}
                </div>
              </div>

              {/* Dates */}
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#999999]">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Dates
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <input
                    type="date"
                    className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-[#0F172B] outline-none hover:border-[#CAD5E2] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
                    placeholder="Start"
                  />
                  <svg className="h-3 w-3 text-[#CAD5E2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <input
                    type="date"
                    value={task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : ''}
                    onChange={(e) => updateTask.mutate({ id: task.id, due_date: e.target.value || null })}
                    className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-[#0F172B] outline-none hover:border-[#CAD5E2] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
                  />
                </div>
              </div>

              {/* Priority */}
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#999999]">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                  </svg>
                  Priority
                </div>
                <select
                  value={task.priority}
                  onChange={(e) => updateTask.mutate({ id: task.id, priority: e.target.value as any })}
                  className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-[#0F172B] outline-none hover:border-[#CAD5E2] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
                >
                  <option value="none">Empty</option>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              {/* Time estimate */}
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#999999]">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Time estimate
                </div>
                <span className="text-xs text-[#CAD5E2]">Empty</span>
              </div>

              {/* Sprint points */}
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#999999]">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Sprint points
                </div>
                <span className="text-xs text-[#CAD5E2]">Empty</span>
              </div>

              {/* Track time */}
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#999999]">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Track time
                </div>
                <button className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Start
                </button>
              </div>

              {/* Tags */}
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#999999]">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  Tags
                </div>
                <div className="flex items-center gap-1">
                  {task.tags && task.tags.length > 0 ? (
                    task.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: `${tag.color}18`, color: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-[#CAD5E2]">Empty</span>
                  )}
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="mb-5">
              {editing === 'description' ? (
                <textarea
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => handleSave('description')}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
                />
              ) : (
                <div
                  onClick={() => { setEditing('description'); setEditValue(task.description || ''); }}
                  className="min-h-[60px] cursor-pointer rounded-lg border border-transparent p-3 text-sm text-[#0F172B] transition hover:border-[#E2E8F0] hover:bg-[#FAFBFC]"
                >
                  {task.description || <span className="text-[#CAD5E2]">Add description, or write with AI</span>}
                </div>
              )}
            </div>

            {/* Custom Fields */}
            <div className="mb-4">
              <button
                onClick={() => setShowFields(!showFields)}
                className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#0F172B]"
              >
                <svg
                  className={`h-3 w-3 transition-transform ${showFields ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Fields
                <div className="flex items-center gap-1">
                  <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                  <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
              </button>

              {showFields && (
                <div className="space-y-0 divide-y divide-[#E2E8F0]/50 rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] p-0">
                  {/* Task type fields */}
                  <div className="px-3 py-2">
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[#999999]">Fields from Task type</p>
                    <div className="flex items-center justify-between py-1">
                      <span className="flex items-center gap-1.5 text-xs text-[#666666]">
                        <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        New Task Check
                      </span>
                      <div className="flex h-4 w-4 items-center justify-center rounded border border-emerald-500 bg-emerald-500">
                        <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* List fields */}
                  <div className="px-3 py-2">
                    <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[#999999]">Fields from this List</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between py-0.5">
                        <span className="flex items-center gap-1.5 text-xs text-[#666666]">
                          <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          #Status
                        </span>
                        <TaskStatusBadge status={status} />
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <span className="flex items-center gap-1.5 text-xs text-[#666666]">
                          <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                          #Type
                        </span>
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700 ring-1 ring-teal-200">
                          Learning
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <span className="flex items-center gap-1.5 text-xs text-[#666666]">
                          <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Work Date
                        </span>
                        <span className="text-xs text-[#CAD5E2]">—</span>
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <span className="flex items-center gap-1.5 text-xs text-[#666666]">
                          <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                          </svg>
                          #Days
                        </span>
                        <span className="text-xs text-[#CAD5E2]">—</span>
                      </div>
                      <div className="flex items-center justify-between py-0.5">
                        <span className="flex items-center gap-1.5 text-xs text-[#666666]">
                          <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                          </svg>
                          Area
                        </span>
                        <span className="text-xs text-[#CAD5E2]">—</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right activity sidebar */}
        <div className="flex w-72 shrink-0 flex-col border-l border-[#E2E8F0] bg-white">
          {/* Activity header */}
          <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-2.5">
            <span className="text-xs font-semibold text-[#0F172B]">Activity</span>
            <div className="flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <svg className="h-3.5 w-3.5 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </div>
          </div>

          {/* Activity log */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {/* Created entry */}
            <div className="mb-4 flex gap-2">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[8px] font-medium text-[#0F172B]">
                {(task.creator?.display_name || task.creator?.email || 'U')?.[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-[#666666]">
                  <span className="font-medium text-[#0F172B]">You</span> created this task
                </p>
                <p className="mt-0.5 text-[10px] text-[#999999]">
                  {new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {new Date(task.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            </div>

            {/* Status change entry (example) */}
            {status && (
              <div className="mb-4 flex gap-2">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[8px] font-medium text-[#0F172B]">
                  {(task.creator?.display_name || task.creator?.email || 'U')?.[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-[#666666]">
                    <span className="font-medium text-[#0F172B]">You</span> changed #Status to{' '}
                    <span
                      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: `${status.color}18`, color: status.color }}
                    >
                      {status.name}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#999999]">
                    {new Date(task.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {new Date(task.updated_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            )}

            {!showAllActivity && (
              <button
                onClick={() => setShowAllActivity(true)}
                className="mb-4 text-xs text-[#999999] hover:text-[#0F172B]"
              >
                Show more
              </button>
            )}

            {/* Comments in activity */}
            {comments?.map((c) => (
              <div key={c.id} className="mb-4 flex gap-2">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[8px] font-medium text-[#0F172B]">
                  {(c.user?.display_name || c.user?.email)?.[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-[#0F172B]">{c.user?.display_name || c.user?.email}</span>
                    <span className="text-[10px] text-[#999999]">
                      {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#666666] leading-relaxed">{c.content}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Comment input */}
          <div className="border-t border-[#E2E8F0] p-3">
            <div className="rounded-lg border border-[#E2E8F0] bg-[#FAFBFC]">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                placeholder="Write a comment..."
                rows={2}
                className="w-full resize-none rounded-t-lg bg-transparent px-3 py-2 text-sm text-[#0F172B] placeholder-[#CAD5E2] outline-none"
              />
              <div className="flex items-center justify-between border-t border-[#E2E8F0]/50 px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <span className="flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-[#666666] ring-1 ring-[#E2E8F0]">
                    Comment
                    <svg className="ml-0.5 h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                  {/* Formatting icons */}
                  {[
                    'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101', // link
                    'M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', // emoji
                    'M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.414a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13', // attach
                  ].map((d, i) => (
                    <button key={i} className="rounded p-1 text-[#999999] hover:bg-[#E2E8F0] hover:text-[#0F172B]">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
                      </svg>
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleAddComment}
                  disabled={!commentText.trim() || addComment.isPending}
                  className="rounded bg-emerald-600 p-1 text-white transition hover:bg-emerald-700 disabled:opacity-40"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
