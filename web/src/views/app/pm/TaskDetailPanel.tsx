import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePMStore } from '../../../stores/pmStore';
import { useTask, useUpdateTask, useDeleteTask, useTaskComments, useAddComment, useCreateTask } from '../../../hooks/useTasks';
import { useTaskTypes } from '../../../hooks/useTaskTypes';
import {
  useChecklists,
  useCreateChecklist,
  useDeleteChecklist,
  useCreateChecklistItem,
  useUpdateChecklistItem,
  useDeleteChecklistItem,
} from '../../../hooks/useChecklists';
import api from '../../../services/api';
import type { SpaceStatus, TaskType, TaskTypeField, TaskMetadata } from '@squadhub/shared';

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
  canEdit = true,
}: {
  statuses: SpaceStatus[];
  listId: string;
  canEdit?: boolean;
}) {
  const { activeTaskId, setActiveTask, timer, startTimer: globalStartTimer, stopTimer: globalStopTimer } = usePMStore();
  const { data: task, isLoading } = useTask(activeTaskId);
  const { data: comments } = useTaskComments(activeTaskId);
  const { data: taskTypes } = useTaskTypes();
  const { data: checklists } = useChecklists(activeTaskId);
  const updateTask = useUpdateTask(listId);
  const deleteTask = useDeleteTask(listId);
  const createTask = useCreateTask(listId);
  const addComment = useAddComment(activeTaskId);
  const createChecklist = useCreateChecklist(activeTaskId);
  const deleteChecklist = useDeleteChecklist(activeTaskId);
  const createChecklistItem = useCreateChecklistItem(activeTaskId);
  const updateChecklistItem = useUpdateChecklistItem(activeTaskId);
  const deleteChecklistItem = useDeleteChecklistItem(activeTaskId);
  const qc = useQueryClient();

  const [editing, setEditing] = useState<'title' | 'description' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [commentText, setCommentText] = useState('');
  const [activeTab, setActiveTab] = useState<'activity' | 'comments'>('activity');
  const [estimateInput, setEstimateInput] = useState('');
  const [editingEstimate, setEditingEstimate] = useState(false);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [newItemDrafts, setNewItemDrafts] = useState<Record<string, string>>({});
  const [newChecklistTitle, setNewChecklistTitle] = useState<string | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<string | null>(null);

  const currentType = useMemo<TaskType | null>(() => {
    if (!task || !taskTypes) return null;
    return taskTypes.find((t) => t.id === (task as any).task_type_id) || null;
  }, [task, taskTypes]);

  const customFields: TaskTypeField[] = currentType?.fields || [];
  const customValues = ((task?.metadata as TaskMetadata | undefined)?.custom || {}) as Record<string, unknown>;

  function updateCustomField(key: string, value: unknown) {
    if (!task) return;
    const nextCustom = { ...customValues, [key]: value };
    const nextMetadata: TaskMetadata = { ...(task.metadata || {}), custom: nextCustom };
    updateTask.mutate({ id: task.id, metadata: nextMetadata });
  }

  const isTimerForThisTask = timer?.taskId === activeTaskId;

  // Tick the display when this task's timer is running
  useEffect(() => {
    if (!isTimerForThisTask || !timer) { setTimerElapsed(0); return; }
    const tick = () => setTimerElapsed(Math.floor((Date.now() - timer.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isTimerForThisTask, timer]);

  const handleStartTimer = async () => {
    if (!task) return;
    // Starting a new timer auto-stops the previous one
    const prev = globalStartTimer(task.id, task.title, listId, task.time_tracked || 0);
    if (prev) {
      // Save the previous timer's tracked time
      const elapsedSecs = Math.floor((Date.now() - prev.startedAt) / 1000);
      const newTracked = prev.baseTracked + elapsedSecs;
      try {
        await api.put(`/pm/tasks/${prev.taskId}`, { time_tracked: newTracked });
        qc.invalidateQueries({ queryKey: ['tasks', prev.listId] });
        qc.invalidateQueries({ queryKey: ['task', prev.taskId] });
      } catch (err) {
        console.error('Failed to save previous timer:', err);
      }
    }
  };

  const handleStopTimer = async () => {
    const stopped = globalStopTimer();
    if (!stopped) return;
    const elapsedSecs = Math.floor((Date.now() - stopped.startedAt) / 1000);
    const newTracked = stopped.baseTracked + elapsedSecs;
    try {
      await api.put(`/pm/tasks/${stopped.taskId}`, { time_tracked: newTracked });
      qc.invalidateQueries({ queryKey: ['tasks', stopped.listId] });
      qc.invalidateQueries({ queryKey: ['task', stopped.taskId] });
    } catch (err) {
      console.error('Failed to save tracked time:', err);
    }
  };

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
          {canEdit && (
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
          )}
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
              onClick={canEdit ? () => { setEditing('title'); setEditValue(task.title); } : undefined}
              className={`mb-5 text-xl font-bold text-[#0F172B] ${canEdit ? 'cursor-pointer hover:text-[#0F172B]/80' : ''}`}
            >
              {task.title}
            </h2>
          )}

          {/* Properties */}
          <div className="mb-6 space-y-0">
            {/* Type */}
            <div className="flex items-center py-2.5">
              <div className="flex w-36 shrink-0 items-center gap-2.5 text-sm text-[#999999]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Type
              </div>
              <div className="relative">
                <button
                  onClick={canEdit ? () => setTypeMenuOpen((v) => !v) : undefined}
                  disabled={!canEdit}
                  className={`flex items-center gap-2 rounded border border-transparent px-2 py-1 text-sm text-[#0F172B] outline-none ${canEdit ? 'hover:border-[#E2E8F0]' : 'cursor-default opacity-70'}`}
                >
                  {currentType ? (
                    <>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: currentType.color }} />
                      <span>{currentType.name}</span>
                    </>
                  ) : (
                    <span className="text-[#CAD5E2]">Select type</span>
                  )}
                  {canEdit && (
                    <svg className="h-3 w-3 text-[#999999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>
                {typeMenuOpen && taskTypes && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setTypeMenuOpen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-lg">
                      {taskTypes.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            updateTask.mutate({ id: task.id, task_type_id: t.id });
                            setTypeMenuOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#F8FAFC] ${
                            currentType?.id === t.id ? 'bg-[#F1F5F9]' : ''
                          }`}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                          <span className="flex-1 text-[#0F172B]">{t.name}</span>
                          {t.is_default && <span className="text-[10px] text-[#90A1B9]">Default</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

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
                disabled={!canEdit}
                className={`rounded border border-transparent px-2 py-1 text-sm text-[#0F172B] outline-none ${canEdit ? 'hover:border-[#E2E8F0] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]' : 'cursor-default opacity-70'}`}
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
                    value={(task as any).work_date || ''}
                    onChange={canEdit ? (e) => updateTask.mutate({ id: task.id, work_date: e.target.value || null }) : undefined}
                    disabled={!canEdit}
                    className={`rounded border border-transparent px-1.5 py-0.5 text-xs text-[#0F172B] outline-none ${canEdit ? 'hover:border-[#E2E8F0] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]' : 'cursor-default opacity-70'}`}
                  />
                </div>
                <span className="text-[#CAD5E2]">|</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[#999999] uppercase">Start</span>
                  <input
                    type="date"
                    value={(task as any).start_date || ''}
                    onChange={canEdit ? (e) => updateTask.mutate({ id: task.id, start_date: e.target.value || null }) : undefined}
                    disabled={!canEdit}
                    className={`rounded border border-transparent px-1.5 py-0.5 text-xs text-[#0F172B] outline-none ${canEdit ? 'hover:border-[#E2E8F0] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]' : 'cursor-default opacity-70'}`}
                  />
                </div>
                <span className="text-[#CAD5E2]">|</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[#999999] uppercase">Due</span>
                  <input
                    type="date"
                    value={task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : ''}
                    onChange={canEdit ? (e) => updateTask.mutate({ id: task.id, due_date: e.target.value || null }) : undefined}
                    disabled={!canEdit}
                    className={`rounded border border-transparent px-1.5 py-0.5 text-xs text-[#0F172B] outline-none ${canEdit ? 'hover:border-[#E2E8F0] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]' : 'cursor-default opacity-70'}`}
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
                      onClick={canEdit ? () => { setEditingEstimate(true); setEstimateInput(formatMinutes(task.time_estimate)); } : undefined}
                      className={`rounded px-1.5 py-0.5 text-xs text-[#0F172B] ${canEdit ? 'cursor-pointer hover:bg-[#F1F5F9]' : ''}`}
                    >
                      {task.time_estimate ? formatMinutes(task.time_estimate) : <span className="text-[#CAD5E2]">&mdash;</span>}
                    </span>
                  )}
                </div>
                <span className="text-[#CAD5E2]">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[#999999] uppercase">Tracked</span>
                  <span className="text-xs text-[#0F172B]">
                    {isTimerForThisTask
                      ? formatSeconds((task.time_tracked || 0) + timerElapsed)
                      : task.time_tracked
                        ? formatSeconds(task.time_tracked)
                        : <span className="text-[#CAD5E2]">0s</span>
                    }
                  </span>
                </div>
                {canEdit && (isTimerForThisTask ? (
                  <button
                    onClick={handleStopTimer}
                    className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100"
                  >
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={handleStartTimer}
                    className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    </svg>
                    Track
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Custom fields (from task type) */}
          {customFields.length > 0 && (
            <div className="mb-6 space-y-0 border-t border-[#E2E8F0] pt-4">
              {customFields.map((field) => (
                <CustomFieldRow
                  key={field.id}
                  field={field}
                  value={customValues[field.key]}
                  onChange={(v) => updateCustomField(field.key, v)}
                  canEdit={canEdit}
                />
              ))}
            </div>
          )}

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
                onClick={canEdit ? () => { setEditing('description'); setEditValue(task.description || ''); } : undefined}
                className={`min-h-[60px] rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] px-4 py-3 text-sm text-[#0F172B] transition ${canEdit ? 'cursor-pointer hover:border-[#CAD5E2]' : ''}`}
              >
                {task.description || <span className="text-[#CAD5E2]">{canEdit ? 'Add a description...' : 'No description'}</span>}
              </div>
            )}
          </div>

          {/* Subtasks */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#0F172B]">Subtasks</h3>
              {canEdit && newSubtaskTitle === null && (
                <button
                  onClick={() => setNewSubtaskTitle('')}
                  className="rounded-md px-2 py-1 text-xs text-[#2962FF] hover:bg-[#F1F5F9]"
                >
                  + Add subtask
                </button>
              )}
            </div>
            {task.subtasks && task.subtasks.length > 0 ? (
              <ul className="space-y-1">
                {task.subtasks.map((st) => {
                  const done = (st as any).status === 'done' || (st as any).status === 'closed';
                  return (
                    <li key={st.id} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[#F8FAFC]">
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={(e) => updateTask.mutate({ id: st.id, status: e.target.checked ? 'done' : 'todo' })}
                        disabled={!canEdit}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-[#CBD5E1]"
                      />
                      <button
                        onClick={() => setActiveTask(st.id)}
                        className={`flex-1 truncate text-left text-sm ${done ? 'text-[#999999] line-through' : 'text-[#0F172B] hover:text-[#2962FF]'}`}
                      >
                        {st.title}
                      </button>
                      {st.due_date && (
                        <span className="text-[10px] text-[#999999]">
                          {new Date(st.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : newSubtaskTitle === null ? (
              <p className="text-xs text-[#CAD5E2]">{canEdit ? 'No subtasks yet' : 'No subtasks'}</p>
            ) : null}
            {canEdit && newSubtaskTitle !== null && (
              <input
                autoFocus
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = newSubtaskTitle.trim();
                    if (val) {
                      createTask.mutate(
                        { title: val, parent_task_id: task.id, list_id: task.list_id },
                        { onSuccess: () => setNewSubtaskTitle('') },
                      );
                    } else {
                      setNewSubtaskTitle(null);
                    }
                  } else if (e.key === 'Escape') {
                    setNewSubtaskTitle(null);
                  }
                }}
                onBlur={() => {
                  const val = newSubtaskTitle.trim();
                  if (val) {
                    createTask.mutate(
                      { title: val, parent_task_id: task.id, list_id: task.list_id },
                      { onSuccess: () => setNewSubtaskTitle(null) },
                    );
                  } else {
                    setNewSubtaskTitle(null);
                  }
                }}
                placeholder="Subtask title, press Enter to add"
                className="mt-1 w-full rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-sm text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              />
            )}
          </div>

          {/* Checklists */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#0F172B]">Checklists</h3>
              {canEdit && newChecklistTitle === null && (
                <button
                  onClick={() => setNewChecklistTitle('')}
                  className="rounded-md px-2 py-1 text-xs text-[#2962FF] hover:bg-[#F1F5F9]"
                >
                  + Add checklist
                </button>
              )}
            </div>
            {canEdit && newChecklistTitle !== null && (
              <input
                autoFocus
                value={newChecklistTitle}
                onChange={(e) => setNewChecklistTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const title = newChecklistTitle.trim();
                    if (title) {
                      createChecklist.mutate(title, { onSuccess: () => setNewChecklistTitle(null) });
                    } else {
                      setNewChecklistTitle(null);
                    }
                  } else if (e.key === 'Escape') {
                    setNewChecklistTitle(null);
                  }
                }}
                onBlur={() => {
                  const title = newChecklistTitle.trim();
                  if (title) {
                    createChecklist.mutate(title, { onSuccess: () => setNewChecklistTitle(null) });
                  } else {
                    setNewChecklistTitle(null);
                  }
                }}
                placeholder="Checklist name, press Enter to create"
                className="mb-2 w-full rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-sm text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              />
            )}
            {checklists && checklists.length > 0 ? (
              <div className="space-y-3">
                {checklists.map((cl) => {
                  const items = cl.items || [];
                  const done = items.filter((i) => i.is_done).length;
                  return (
                    <div key={cl.id} className="rounded-lg border border-[#E2E8F0] bg-[#FAFBFC] p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-[#0F172B]">
                          <span>{cl.title}</span>
                          <span className="text-xs text-[#999999]">{done}/{items.length}</span>
                        </div>
                        {canEdit && (
                          <button
                            onClick={() => { if (confirm(`Delete checklist "${cl.title}"?`)) deleteChecklist.mutate(cl.id); }}
                            className="text-xs text-[#CAD5E2] hover:text-red-500"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <ul className="space-y-1">
                        {items.map((item) => (
                          <li key={item.id} className="group flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={item.is_done}
                              onChange={(e) => updateChecklistItem.mutate({ id: item.id, is_done: e.target.checked })}
                              disabled={!canEdit}
                              className="h-3.5 w-3.5 cursor-pointer rounded border-[#CBD5E1]"
                            />
                            <span className={`flex-1 text-sm ${item.is_done ? 'text-[#999999] line-through' : 'text-[#0F172B]'}`}>
                              {item.content}
                            </span>
                            {canEdit && (
                              <button
                                onClick={() => deleteChecklistItem.mutate(item.id)}
                                className="text-xs text-[#CAD5E2] opacity-0 group-hover:opacity-100 hover:text-red-500"
                              >
                                ×
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                      {canEdit && (
                        <input
                          placeholder="+ Add item"
                          value={newItemDrafts[cl.id] || ''}
                          onChange={(e) => setNewItemDrafts((prev) => ({ ...prev, [cl.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = (newItemDrafts[cl.id] || '').trim();
                              if (val) {
                                createChecklistItem.mutate({ checklistId: cl.id, content: val });
                                setNewItemDrafts((prev) => ({ ...prev, [cl.id]: '' }));
                              }
                            }
                          }}
                          className="mt-2 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-[#0F172B] placeholder-[#CAD5E2] outline-none focus:border-[#E2E8F0] focus:bg-white"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-[#CAD5E2]">{canEdit ? 'No checklists yet' : 'No checklists'}</p>
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

function CustomFieldRow({
  field,
  value,
  onChange,
  canEdit,
}: {
  field: TaskTypeField;
  value: unknown;
  onChange: (v: unknown) => void;
  canEdit: boolean;
}) {
  const baseInputCls = `rounded border border-transparent px-1.5 py-0.5 text-xs text-[#0F172B] outline-none ${canEdit ? 'hover:border-[#E2E8F0] focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]' : 'cursor-default opacity-70'}`;

  let control: React.ReactNode = null;
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);

  switch (field.field_type) {
    case 'textarea':
      control = (
        <textarea
          defaultValue={str}
          placeholder={field.placeholder || ''}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== str && onChange(e.target.value || null)}
          rows={2}
          className={`${baseInputCls} w-full resize-none`}
        />
      );
      break;
    case 'select':
      control = (
        <select
          value={str}
          disabled={!canEdit}
          onChange={(e) => onChange(e.target.value || null)}
          className={baseInputCls}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
      break;
    case 'multi_select': {
      const arr: string[] = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((o) => {
            const on = arr.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  const next = on ? arr.filter((v) => v !== o.value) : [...arr, o.value];
                  onChange(next);
                }}
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  on ? 'bg-[#2962FF] text-white' : 'bg-[#F1F5F9] text-[#62748E] hover:bg-[#E2E8F0]'
                } ${canEdit ? '' : 'cursor-default opacity-70'}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
      break;
    }
    case 'number':
      control = (
        <input
          type="number"
          defaultValue={str}
          placeholder={field.placeholder || ''}
          disabled={!canEdit}
          onBlur={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : Number(v));
          }}
          className={baseInputCls}
        />
      );
      break;
    case 'date':
      control = (
        <input
          type="date"
          value={str}
          disabled={!canEdit}
          onChange={(e) => onChange(e.target.value || null)}
          className={baseInputCls}
        />
      );
      break;
    case 'url':
      control = (
        <input
          type="url"
          defaultValue={str}
          placeholder={field.placeholder || 'https://'}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== str && onChange(e.target.value || null)}
          className={`${baseInputCls} min-w-[240px]`}
        />
      );
      break;
    case 'checkbox':
      control = (
        <input
          type="checkbox"
          checked={!!value}
          disabled={!canEdit}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer rounded border-[#CBD5E1]"
        />
      );
      break;
    case 'text':
    default:
      control = (
        <input
          type="text"
          defaultValue={str}
          placeholder={field.placeholder || ''}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== str && onChange(e.target.value || null)}
          className={`${baseInputCls} min-w-[200px]`}
        />
      );
  }

  return (
    <div className="flex items-start py-2.5">
      <div className="flex w-36 shrink-0 items-center gap-2.5 pt-0.5 text-sm text-[#999999]">
        <span className="truncate">{field.label}</span>
        {field.is_required && <span className="text-red-500">*</span>}
      </div>
      <div className="min-w-0 flex-1">{control}</div>
    </div>
  );
}
