import { useState, useEffect, useRef, useCallback } from 'react';
import { usePMStore } from '../../../stores/pmStore';
import { useTask, useUpdateTask, useDeleteTask, useTaskComments, useAddComment } from '../../../hooks/useTasks';
import type { SpaceStatus } from '@squadhub/shared';

function parseTimeInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let totalMinutes = 0;
  const hourMatch = trimmed.match(/(\d+)\s*h/);
  const minMatch = trimmed.match(/(\d+)\s*m/);
  if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
  if (minMatch) totalMinutes += parseInt(minMatch[1]);
  if (!hourMatch && !minMatch) {
    const num = parseFloat(trimmed);
    if (!isNaN(num)) totalMinutes = Math.round(num * 60);
    else return null;
  }
  return totalMinutes > 0 ? totalMinutes : null;
}

function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function formatSeconds(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h) return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  if (m) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

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
  const [activeTab, setActiveTab] = useState<'activity' | 'comments'>('activity');
  const [estimateInput, setEstimateInput] = useState('');
  const [editingEstimate, setEditingEstimate] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStartRef = useRef<number>(0);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (timerElapsed > 0 && task) {
      const newTracked = (task.time_tracked || 0) + timerElapsed;
      updateTask.mutate({ id: task.id, time_tracked: newTracked });
    }
    setTimerRunning(false);
    setTimerElapsed(0);
  }, [timerElapsed, task, updateTask]);

  const startTimer = useCallback(() => {
    timerStartRef.current = Date.now();
    setTimerElapsed(0);
    setTimerRunning(true);
    timerRef.current = setInterval(() => {
      setTimerElapsed(Math.floor((Date.now() - timerStartRef.current) / 1000));
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (!activeTaskId) return null;

  if (isLoading || !task) {
    return (
      <div className="flex w-[520px] items-center justify-center border-l border-[#E2E8F0] bg-white">
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

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return {
      date: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };
  };

  const created = formatDateTime(task.created_at);

  return (
    <div className="flex w-[520px] shrink-0 flex-col border-l border-[#E2E8F0] bg-white">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3">
        <button
          onClick={() => setActiveTask(null)}
          className="rounded p-1 text-[#666666] hover:bg-[#F1F5F9] hover:text-[#0F172B]"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <button className="rounded p-1.5 text-[#999999] hover:bg-[#F1F5F9] hover:text-[#0F172B]">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button className="rounded p-1.5 text-[#999999] hover:bg-[#F1F5F9] hover:text-yellow-500">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
          <button
            onClick={handleDelete}
            className="rounded p-1.5 text-[#999999] hover:bg-[#F1F5F9] hover:text-red-500"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-5">
          {/* Task Title */}
          {editing === 'title' ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave('title'); if (e.key === 'Escape') setEditing(null); }}
              onBlur={() => handleSave('title')}
              className="mb-5 w-full rounded border border-[#CAD5E2] px-2 py-1.5 text-xl font-bold text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            />
          ) : (
            <h2
              onClick={() => { setEditing('title'); setEditValue(task.title); }}
              className="mb-5 cursor-pointer text-xl font-bold text-[#0F172B] hover:text-[#0F172B]/80"
            >
              {task.title}
            </h2>
          )}

          {/* Properties */}
          <div className="mb-6 space-y-0">
            {/* Status */}
            <div className="flex items-center py-2.5">
              <div className="flex w-36 shrink-0 items-center gap-2.5 text-sm text-[#999999]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Status
              </div>
              <select
                value={(task as any).status}
                onChange={(e) => updateTask.mutate({ id: task.id, status: e.target.value })}
                className="rounded border border-transparent px-2 py-1 text-sm text-[#0F172B] outline-none hover:border-[#E2E8F0] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
                style={status ? { color: status.color } : {}}
              >
                {statuses.map((s) => (
                  <option key={s.id} value={s.category}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Assignee */}
            <div className="flex items-center py-2.5">
              <div className="flex w-36 shrink-0 items-center gap-2.5 text-sm text-[#999999]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Assignee
              </div>
              <div className="flex items-center gap-2">
                {task.assignees && task.assignees.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-1.5">
                      {task.assignees.map((u: any) => (
                        <div
                          key={u.id}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B] ring-2 ring-white"
                          title={u.display_name || u.email}
                        >
                          {(u.display_name || u.email)?.[0]?.toUpperCase()}
                        </div>
                      ))}
                    </div>
                    <span className="text-sm text-[#0F172B]">
                      {task.assignees.map((u: any) => u.display_name || u.email).join(', ')}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-[#CAD5E2]">Unassigned</span>
                )}
              </div>
            </div>

            {/* Dates row: Work date, Start date, Due date */}
            <div className="flex items-center py-2.5">
              <div className="flex w-36 shrink-0 items-center gap-2.5 text-sm text-[#999999]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Dates
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[#999999] uppercase">Work</span>
                  <input
                    type="date"
                    className="rounded border border-transparent px-1.5 py-0.5 text-xs text-[#0F172B] outline-none hover:border-[#E2E8F0] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
                  />
                </div>
                <span className="text-[#CAD5E2]">|</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[#999999] uppercase">Start</span>
                  <input
                    type="date"
                    className="rounded border border-transparent px-1.5 py-0.5 text-xs text-[#0F172B] outline-none hover:border-[#E2E8F0] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
                  />
                </div>
                <span className="text-[#CAD5E2]">|</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[#999999] uppercase">Due</span>
                  <input
                    type="date"
                    value={task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : ''}
                    onChange={(e) => updateTask.mutate({ id: task.id, due_date: e.target.value || null })}
                    className="rounded border border-transparent px-1.5 py-0.5 text-xs text-[#0F172B] outline-none hover:border-[#E2E8F0] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
                  />
                </div>
              </div>
            </div>

            {/* Time estimate & Time tracked */}
            <div className="flex items-center py-2.5">
              <div className="flex w-36 shrink-0 items-center gap-2.5 text-sm text-[#999999]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Time
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[#999999] uppercase">Estimate</span>
                  {editingEstimate ? (
                    <input
                      autoFocus
                      value={estimateInput}
                      onChange={(e) => setEstimateInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const mins = parseTimeInput(estimateInput);
                          updateTask.mutate({ id: task.id, time_estimate: mins });
                          setEditingEstimate(false);
                        }
                        if (e.key === 'Escape') setEditingEstimate(false);
                      }}
                      onBlur={() => {
                        const mins = parseTimeInput(estimateInput);
                        updateTask.mutate({ id: task.id, time_estimate: mins });
                        setEditingEstimate(false);
                      }}
                      placeholder="e.g. 2h 30m"
                      className="w-20 rounded border border-[#2962FF] px-1.5 py-0.5 text-xs text-[#0F172B] outline-none focus:ring-1 focus:ring-[#2962FF]"
                    />
                  ) : (
                    <span
                      onClick={() => { setEditingEstimate(true); setEstimateInput(formatMinutes(task.time_estimate)); }}
                      className="cursor-pointer rounded px-1.5 py-0.5 text-xs text-[#0F172B] hover:bg-[#F1F5F9]"
                    >
                      {task.time_estimate ? formatMinutes(task.time_estimate) : <span className="text-[#CAD5E2]">&mdash;</span>}
                    </span>
                  )}
                </div>
                <span className="text-[#CAD5E2]">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[#999999] uppercase">Tracked</span>
                  <span className="text-xs text-[#0F172B]">
                    {timerRunning
                      ? formatSeconds((task.time_tracked || 0) + timerElapsed)
                      : task.time_tracked
                        ? formatSeconds(task.time_tracked)
                        : <span className="text-[#CAD5E2]">0s</span>
                    }
                  </span>
                </div>
                {timerRunning ? (
                  <button
                    onClick={stopTimer}
                    className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100"
                  >
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={startTimer}
                    className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    </svg>
                    Track
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="mb-6">
            <h3 className="mb-2 text-sm font-semibold text-[#0F172B]">Description</h3>
            {editing === 'description' ? (
              <textarea
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => handleSave('description')}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }}
                rows={5}
                className="w-full resize-none rounded-lg border border-[#CAD5E2] bg-[#FAFBFC] px-3 py-2.5 text-sm text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              />
            ) : (
              <div
                onClick={() => { setEditing('description'); setEditValue(task.description || ''); }}
                className="min-h-[60px] cursor-pointer rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] px-4 py-3 text-sm text-[#0F172B] transition hover:border-[#CAD5E2]"
              >
                {task.description || <span className="text-[#CAD5E2]">Add a description...</span>}
              </div>
            )}
          </div>

          {/* Tabs: Activity / Comments */}
          <div className="border-b border-[#E2E8F0]">
            <div className="flex gap-0">
              <button
                onClick={() => setActiveTab('activity')}
                className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
                  activeTab === 'activity'
                    ? 'border-[#2962FF] text-[#0F172B]'
                    : 'border-transparent text-[#999999] hover:text-[#666666]'
                }`}
              >
                Activity
              </button>
              <button
                onClick={() => setActiveTab('comments')}
                className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
                  activeTab === 'comments'
                    ? 'border-[#2962FF] text-[#0F172B]'
                    : 'border-transparent text-[#999999] hover:text-[#666666]'
                }`}
              >
                Comments
                {comments && comments.length > 0 && (
                  <span className="ml-1.5 text-xs text-[#999999]">{comments.length}</span>
                )}
              </button>
            </div>
          </div>

          {/* Tab content */}
          <div className="py-4">
            {activeTab === 'activity' && (
              <div className="space-y-4">
                {/* Created entry */}
                <div className="flex gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B]">
                    {(task.creator?.display_name || task.creator?.email || 'U')?.[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-[#666666]">
                      <span className="font-medium text-[#0F172B]">{task.creator?.display_name || 'You'}</span>
                      {' '}created this task
                    </p>
                    <p className="mt-0.5 text-xs text-[#999999]">{created.date} {created.time}</p>
                  </div>
                </div>

                {/* Status change */}
                {status && (
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B]">
                      {(task.creator?.display_name || task.creator?.email || 'U')?.[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-[#666666]">
                        <span className="font-medium text-[#0F172B]">{task.creator?.display_name || 'You'}</span>
                        {' '}changed the status to{' '}
                        <span
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
                          style={{ backgroundColor: `${status.color}18`, color: status.color }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                          {status.name}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-[#999999]">
                        {formatDateTime(task.updated_at).date} {formatDateTime(task.updated_at).time}
                      </p>
                    </div>
                  </div>
                )}

                {/* Comments shown in activity */}
                {comments?.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B]">
                      {(c.user?.display_name || c.user?.email)?.[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-[#666666]">
                        <span className="font-medium text-[#0F172B]">{c.user?.display_name || c.user?.email}</span>
                        {' '}added a comment
                      </p>
                      <p className="mt-1 rounded bg-[#FAFBFC] px-3 py-2 text-sm text-[#666666]">{c.content}</p>
                      <p className="mt-0.5 text-xs text-[#999999]">
                        {formatDateTime(c.created_at).date} {formatDateTime(c.created_at).time}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="space-y-4">
                {comments && comments.length > 0 ? (
                  comments.map((c) => (
                    <div key={c.id} className="flex gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#0F172B]">
                        {(c.user?.display_name || c.user?.email)?.[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#0F172B]">{c.user?.display_name || c.user?.email}</span>
                          <span className="text-xs text-[#999999]">
                            {formatDateTime(c.created_at).date} {formatDateTime(c.created_at).time}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[#666666] leading-relaxed">{c.content}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[#CAD5E2]">No comments yet</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Comment input (always visible at bottom) */}
      <div className="border-t border-[#E2E8F0] px-5 py-3">
        <div className="flex gap-2">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
            placeholder="Write a comment..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] px-3 py-2 text-sm text-[#0F172B] placeholder-[#CAD5E2] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
          />
          <button
            onClick={handleAddComment}
            disabled={!commentText.trim() || addComment.isPending}
            className="rounded-lg bg-[#2962FF] px-3 py-2 text-white transition hover:bg-[#1E50E0] disabled:opacity-40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
