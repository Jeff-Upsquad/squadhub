'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTaskStatusCategory, getTaskStatusDef, type SpaceStatus, type Task } from '@squadhub/shared';
import api from '../../services/api';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useMyTasks } from '../../hooks/useTasks';
import { showToast } from '../Toast';
import TaskStatusBadge from '../../views/app/pm/TaskStatusBadge';

export interface RelatedTaskItem {
  id: string;
  title: string;
  status: string;
  original_status?: string | null;
  priority?: string | null;
  display_number?: number | null;
  due_date?: string | null;
  completed: boolean;
  list_id: string;
  list_name?: string | null;
  space_id?: string | null;
  space_name?: string | null;
  space_color?: string | null;
  created_at?: string | null;
}

interface RelationshipsData {
  waiting_on: RelatedTaskItem[];
  blocks: RelatedTaskItem[];
}

interface SearchHit {
  id: string;
  title: string;
  status: string;
  category?: string | null;
  priority?: string | null;
  due_date?: string | null;
  display_number?: number | null;
  list_id: string;
  list_name?: string | null;
  folder_name?: string | null;
  space_id?: string | null;
  space_name?: string | null;
  space_color?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function TaskRelationshipsModal({
  taskId,
  taskTitle,
  currentStatus,
  originalStatus,
  onClose,
}: {
  taskId: string;
  taskTitle: string;
  currentStatus?: SpaceStatus | string | null;
  originalStatus?: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const [mode, setMode] = useState<'overview' | 'waiting_on' | 'blocks'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounced(searchQuery.trim(), 160);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape when in overview, or return to overview when searching
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (mode !== 'overview') {
          setMode('overview');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [mode, onClose]);

  useEffect(() => {
    if (mode !== 'overview') {
      const id = requestAnimationFrame(() => searchInputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [mode]);

  // Fetch current relationships
  const { data: relsData, isLoading: isLoadingRels, refetch: refetchRels } = useQuery<RelationshipsData>({
    queryKey: ['task-relationships', taskId],
    queryFn: async () => {
      const res = await api.get(`/pm/tasks/${taskId}/relationships`);
      return res.data?.data || { waiting_on: [], blocks: [] };
    },
    staleTime: 5000,
  });

  const waitingOnList = relsData?.waiting_on || [];
  const blocksList = relsData?.blocks || [];

  // Search tasks across workspace
  const searchResults = useQuery<SearchHit[]>({
    queryKey: ['relationship-search', workspaceId, debouncedQuery],
    queryFn: async () => {
      const res = await api.get('/pm/search', {
        params: { workspace_id: workspaceId, q: debouncedQuery, limit: 30, include_subtasks: true },
      });
      return res.data?.data?.tasks || [];
    },
    enabled: !!workspaceId && debouncedQuery.length > 0 && mode !== 'overview',
    staleTime: 15000,
  });

  // Default suggestions from user's open tasks
  const { data: mine } = useMyTasks();
  const defaultSuggestions = useMemo(() => {
    if (!mine) return [] as SearchHit[];
    const seen = new Set<string>();
    const out: SearchHit[] = [];
    for (const bucket of ['focused', 'overdue', 'today', 'tomorrow', 'upcoming', 'later'] as const) {
      for (const t of (mine[bucket] || [])) {
        if (seen.has(t.id) || t.id === taskId) continue;
        seen.add(t.id);
        out.push({
          id: t.id,
          title: t.title,
          status: typeof t.status === 'string' ? t.status : (t.status as any)?.name ?? 'open',
          category: (t as any).category ?? null,
          priority: t.priority ?? null,
          due_date: t.due_date ?? null,
          display_number: (t as any).display_number ?? null,
          list_id: t.list_id,
          list_name: (t as any).list_name ?? (t as any).list?.name ?? null,
          space_name: (t as any).space_name ?? (t as any).space?.name ?? null,
          space_color: (t as any).space_color ?? null,
        });
        if (out.length >= 15) break;
      }
      if (out.length >= 15) break;
    }
    return out;
  }, [mine, taskId]);

  const displayedTasks = useMemo(() => {
    if (debouncedQuery.length > 0) {
      return (searchResults.data || []).filter((t) => t.id !== taskId);
    }
    return defaultSuggestions;
  }, [debouncedQuery, searchResults.data, defaultSuggestions, taskId]);

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: async ({ type, targetTaskId }: { type: 'waiting_on' | 'blocks'; targetTaskId: string }) => {
      const res = await api.post(`/pm/tasks/${taskId}/relationships`, {
        type,
        target_task_id: targetTaskId,
      });
      return res.data;
    },
    onSuccess: (_, vars) => {
      const target = displayedTasks.find((t) => t.id === vars.targetTaskId);
      const targetTitle = target?.title || 'task';
      if (vars.type === 'waiting_on') {
        showToast(`Linked: This task is now waiting on "${targetTitle}". Status updated to Waiting on dependency.`, 'success');
      } else {
        showToast(`Linked: "${targetTitle}" is now blocked by this task. Its status updated to Waiting on dependency.`, 'success');
      }
      qc.invalidateQueries({ queryKey: ['task-relationships', taskId] });
      qc.invalidateQueries({ queryKey: ['task-relationships', vars.targetTaskId] });
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['task', vars.targetTaskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['pm-tasks'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      refetchRels();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || 'Failed to connect task', 'error');
    },
  });

  // Unlink mutation
  const unlinkMutation = useMutation({
    mutationFn: async (targetTaskId: string) => {
      const res = await api.delete(`/pm/tasks/${taskId}/relationships/${targetTaskId}`);
      return res.data;
    },
    onSuccess: () => {
      showToast('Relationship removed', 'info');
      qc.invalidateQueries({ queryKey: ['task-relationships', taskId] });
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['pm-tasks'] });
      refetchRels();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || 'Failed to remove relationship', 'error');
    },
  });

  const waitingOnIds = new Set(waitingOnList.map((t) => t.id));
  const blocksIds = new Set(blocksList.map((t) => t.id));

  const statusString = typeof currentStatus === 'string' ? currentStatus : currentStatus?.name ?? null;
  const statusDef = getTaskStatusDef(statusString);
  const statusLabel = (currentStatus && typeof currentStatus !== 'string' ? currentStatus.name : null) || statusDef?.label || statusString || 'Open';
  const statusColor = (currentStatus && typeof currentStatus !== 'string' ? currentStatus.color : null) || statusDef?.color || '#6b7280';

  const isWaitingOrUnblocked = statusString === 'waiting_on_dependency' || statusString === 'unblocked'
    || (statusLabel.toUpperCase().includes('WAITING') && statusLabel.toUpperCase().includes('DEPEND'))
    || statusLabel.toUpperCase() === 'UNBLOCKED';
  const origDef = originalStatus ? getTaskStatusDef(originalStatus) : null;
  const origLabel = origDef?.label || originalStatus || null;
  const origColor = origDef?.color || '#6b7280';

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-divider bg-surface shadow-2xl transition-all"
        style={{ background: 'var(--surface, #ffffff)', color: 'var(--foreground, #111827)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider px-6 py-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-foreground">Task Relationships</h3>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ backgroundColor: `${statusColor}18`, color: statusColor }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
                  <span>{statusLabel}</span>
                  {isWaitingOrUnblocked && origLabel && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.2 text-[10px] font-medium border"
                      style={{
                        borderColor: `${statusColor}40`,
                        backgroundColor: `${origColor}18`,
                        color: origColor,
                      }}
                      title={`Original status: ${origLabel}`}
                    >
                      <span className="h-1 w-1 rounded-full" style={{ backgroundColor: origColor }} />
                      <span>{origLabel}</span>
                    </span>
                  )}
                </span>
              </div>
              <p className="truncate text-xs text-foreground-dim" title={taskTitle}>
                {taskTitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-foreground-dim hover:bg-muted hover:text-foreground transition"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        {mode === 'overview' ? (
          <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
            {/* Action Cards */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground-dim mb-2.5">
                Connect New Relationship
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Waiting on button */}
                <button
                  type="button"
                  onClick={() => {
                    setMode('waiting_on');
                    setSearchQuery('');
                  }}
                  className="flex flex-col text-left p-4 rounded-xl border border-divider hover:border-blue-500/50 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition group"
                >
                  <div className="flex items-center justify-between w-full mb-1.5">
                    <span className="flex items-center gap-2 text-sm font-bold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      Waiting on
                    </span>
                    <span className="text-xs text-foreground-dim group-hover:translate-x-0.5 transition">→</span>
                  </div>
                  <p className="text-xs text-foreground-muted mb-2.5 leading-relaxed">
                    This task is waiting on another task to finish before it can proceed.
                  </p>
                  <span className="mt-auto inline-flex items-center text-[10.5px] font-medium text-amber-700 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-300 px-2 py-0.5 rounded-md">
                    Moves this task to Waiting on dependency
                  </span>
                </button>

                {/* Blocks button */}
                <button
                  type="button"
                  onClick={() => {
                    setMode('blocks');
                    setSearchQuery('');
                  }}
                  className="flex flex-col text-left p-4 rounded-xl border border-divider hover:border-red-500/50 hover:bg-red-50/30 dark:hover:bg-red-950/20 transition group"
                >
                  <div className="flex items-center justify-between w-full mb-1.5">
                    <span className="flex items-center gap-2 text-sm font-bold text-foreground group-hover:text-red-600 dark:group-hover:text-red-400">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      Blocks
                    </span>
                    <span className="text-xs text-foreground-dim group-hover:translate-x-0.5 transition">→</span>
                  </div>
                  <p className="text-xs text-foreground-muted mb-2.5 leading-relaxed">
                    This task blocks another task from being worked on or completed.
                  </p>
                  <span className="mt-auto inline-flex items-center text-[10.5px] font-medium text-purple-700 bg-purple-50 dark:bg-purple-950/50 dark:text-purple-300 px-2 py-0.5 rounded-md">
                    Moves blocked task to Waiting on dependency
                  </span>
                </button>
              </div>
            </div>

            {/* Current Relationships */}
            <div className="space-y-5 pt-2 border-t border-divider">
              {/* Waiting on section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim flex items-center gap-1.5">
                    <span>Waiting on</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-medium text-foreground">
                      {waitingOnList.length}
                    </span>
                  </h4>
                  {waitingOnList.length > 0 && (
                    <span className="text-[11px] text-foreground-dim">This task is waiting on these tasks</span>
                  )}
                </div>

                {isLoadingRels ? (
                  <div className="py-4 text-center text-xs text-foreground-dim">Loading relationships…</div>
                ) : waitingOnList.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-divider p-3 text-center text-xs text-foreground-dim">
                    Not waiting on any tasks. Click <strong>Waiting on</strong> above to connect dependencies.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {waitingOnList.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-divider hover:bg-muted/40 transition"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: item.completed ? '#10b981' : '#f59e0b',
                            }}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground" title={item.title}>
                              {item.title}
                            </p>
                            <div className="flex items-center gap-1.5 text-[11px] text-foreground-dim">
                              <TaskStatusBadge status={item.status} originalStatus={item.original_status} />
                              {item.space_name && <span>{item.space_name}</span>}
                              {item.space_name && item.list_name && <span>›</span>}
                              {item.list_name && <span>{item.list_name}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.completed ? (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              ✓ Completed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              Blocking
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => unlinkMutation.mutate(item.id)}
                            disabled={unlinkMutation.isPending}
                            className="rounded p-1 text-foreground-dim hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                            title="Unlink dependency"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Blocks section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim flex items-center gap-1.5">
                    <span>Blocks</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-medium text-foreground">
                      {blocksList.length}
                    </span>
                  </h4>
                  {blocksList.length > 0 && (
                    <span className="text-[11px] text-foreground-dim">These tasks are waiting on this task</span>
                  )}
                </div>

                {isLoadingRels ? (
                  <div className="py-4 text-center text-xs text-foreground-dim">Loading relationships…</div>
                ) : blocksList.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-divider p-3 text-center text-xs text-foreground-dim">
                    Not blocking any tasks. Click <strong>Blocks</strong> above to mark tasks as dependent on this.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {blocksList.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-divider hover:bg-muted/40 transition"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: item.completed ? '#10b981' : '#6b7280',
                            }}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground" title={item.title}>
                              {item.title}
                            </p>
                            <div className="flex items-center gap-1.5 text-[11px] text-foreground-dim">
                              <TaskStatusBadge status={item.status} originalStatus={item.original_status} />
                              {item.space_name && <span>{item.space_name}</span>}
                              {item.space_name && item.list_name && <span>›</span>}
                              {item.list_name && <span>{item.list_name}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => unlinkMutation.mutate(item.id)}
                            disabled={unlinkMutation.isPending}
                            className="rounded p-1 text-foreground-dim hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                            title="Unlink relationship"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Search / Connect View (Goal Link style) */
          <div className="flex flex-col max-h-[75vh]">
            {/* Search Header */}
            <div className="p-4 border-b border-divider bg-muted/20">
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={() => setMode('overview')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground-muted hover:text-foreground transition"
                >
                  <span>←</span> Back to relationships
                </button>
                <span className="text-[11px] font-medium text-foreground-dim">
                  {mode === 'waiting_on' ? (
                    <span className="text-amber-600 dark:text-amber-400">Status will update to Waiting on dependency</span>
                  ) : (
                    <span className="text-purple-600 dark:text-purple-400">Blocked task moves to Waiting on dependency</span>
                  )}
                </span>
              </div>

              {/* Search Bar */}
              <div className="relative flex items-center">
                <svg
                  className="absolute left-3 h-4 w-4 text-foreground-dim pointer-events-none"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    mode === 'waiting_on'
                      ? 'Search tasks to wait on across workspace…'
                      : 'Search tasks to block across workspace…'
                  }
                  className="w-full rounded-xl border border-divider bg-surface pl-9 pr-12 py-2.5 text-sm focus:border-ink focus:outline-none"
                />
                {searchResults.isFetching && (
                  <span className="absolute right-8 h-3.5 w-3.5 animate-spin rounded-full border-2 border-foreground-dim border-t-transparent" />
                )}
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 p-1 text-foreground-dim hover:text-foreground"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-dim">
                {debouncedQuery ? `Search Results (${displayedTasks.length})` : 'Your open tasks'}
              </p>

              {displayedTasks.length === 0 ? (
                <div className="py-8 text-center text-xs text-foreground-dim">
                  {debouncedQuery ? `No tasks found matching "${debouncedQuery}"` : 'No open tasks found'}
                </div>
              ) : (
                displayedTasks.map((t) => {
                  const isWaitingOnThis = waitingOnIds.has(t.id);
                  const isBlockedByThis = blocksIds.has(t.id);
                  const isConnected = isWaitingOnThis || isBlockedByThis;
                  const isPending = connectMutation.isPending && connectMutation.variables?.targetTaskId === t.id;

                  return (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-divider hover:bg-muted/40 transition group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: t.space_color || '#6b7280',
                          }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground group-hover:text-blue-600 transition" title={t.title}>
                            {t.title}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-foreground-dim">
                            {t.space_name && <span>{t.space_name}</span>}
                            {t.space_name && t.list_name && <span>›</span>}
                            {t.list_name && <span>{t.list_name}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {isConnected ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            ✓ {isWaitingOnThis ? 'Waiting on' : 'Blocked'}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              connectMutation.mutate({
                                type: mode as 'waiting_on' | 'blocks',
                                targetTaskId: t.id,
                              })
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
                          >
                            {isPending ? 'Connecting…' : `+ Connect ${mode === 'waiting_on' ? 'Dependency' : 'Block'}`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-divider bg-muted/20 flex items-center justify-between text-xs text-foreground-dim">
              <span>Press <kbd className="rounded border bg-surface px-1 py-0.5 text-[10px]">esc</kbd> to return</span>
              <button
                type="button"
                onClick={() => setMode('overview')}
                className="rounded-lg bg-ink px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 transition"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Modal Footer in overview mode */}
        {mode === 'overview' && (
          <div className="flex items-center justify-end border-t border-divider px-6 py-3 bg-muted/20">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-ink px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 transition"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
