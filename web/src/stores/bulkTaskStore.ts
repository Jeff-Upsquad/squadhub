import { create } from 'zustand';
import type { Task } from '@squadhub/shared';
import { runBulkTasks, type BulkTaskFailure } from '../lib/bulkTasks';

export interface BulkTaskJob {
  id: string;
  title: string;
  total: number;
  completed: number;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  failures: BulkTaskFailure[];
  tasks: Task[];
  action: (task: Task) => Promise<unknown>;
  createdAt: number;
  finishedAt?: number;
  expandedErrors?: boolean;
  abortController?: AbortController;
}

export interface BulkTaskStore {
  jobs: BulkTaskJob[];
  startJob: (params: {
    title: string;
    tasks: Task[];
    action: (task: Task) => Promise<unknown>;
    onSuccess?: () => void;
  }) => string;
  updateProgress: (jobId: string, completed: number, failure?: BulkTaskFailure) => void;
  finishJob: (jobId: string, failures: BulkTaskFailure[]) => void;
  toggleErrors: (jobId: string) => void;
  dismissJob: (jobId: string) => void;
  cancelJob: (jobId: string) => void;
  retryJob: (jobId: string) => void;
  clearCompleted: () => void;
}

export const useBulkTaskStore = create<BulkTaskStore>((set, get) => ({
  jobs: [],

  startJob: (params) => {
    const id = `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const abortController = new AbortController();
    const newJob: BulkTaskJob = {
      id,
      title: params.title,
      total: params.tasks.length,
      completed: 0,
      status: 'running',
      failures: [],
      tasks: params.tasks,
      action: params.action,
      createdAt: Date.now(),
      expandedErrors: false,
      abortController,
    };

    set((state) => ({ jobs: [newJob, ...state.jobs] }));

    // Execute in background
    void (async () => {
      try {
        const failures = await runBulkTasks(params.tasks, params.action, {
          signal: abortController.signal,
          onProgress: (completed, _total, failure) => {
            get().updateProgress(id, completed, failure);
          },
        });
        get().finishJob(id, failures);
        params.onSuccess?.();
      } catch (err) {
        const msg = (err as Error)?.message || 'Bulk operation failed';
        get().finishJob(id, [{ id: 'error', title: params.title, message: msg }]);
      }
    })();

    return id;
  },

  updateProgress: (jobId, completed, failure) => {
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              completed,
              failures: failure ? [...j.failures, failure] : j.failures,
            }
          : j
      ),
    }));
  },

  finishJob: (jobId, failures) => {
    const job = get().jobs.find((j) => j.id === jobId);
    const isAborted = !!job?.abortController?.signal.aborted;
    const finalStatus = isAborted
      ? 'aborted'
      : failures.length === job?.total && (job?.total || 0) > 0
      ? 'failed'
      : 'completed';

    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              completed: j.total,
              status: finalStatus,
              failures,
              finishedAt: Date.now(),
              expandedErrors: failures.length > 0,
            }
          : j
      ),
    }));

    // Auto-dismiss cleanly completed jobs after 7 seconds
    if (!failures.length && !isAborted) {
      setTimeout(() => {
        get().dismissJob(jobId);
      }, 7000);
    }
  },

  toggleErrors: (jobId) => {
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === jobId ? { ...j, expandedErrors: !j.expandedErrors } : j
      ),
    }));
  },

  dismissJob: (jobId) => {
    set((state) => ({
      jobs: state.jobs.filter((j) => j.id !== jobId),
    }));
  },

  cancelJob: (jobId) => {
    const job = get().jobs.find((j) => j.id === jobId);
    if (job?.abortController) {
      job.abortController.abort();
    }
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.id === jobId ? { ...j, status: 'aborted' as const } : j
      ),
    }));
  },

  retryJob: (jobId) => {
    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || !job.failures.length) return;

    const failedIds = new Set(job.failures.map((f) => f.id));
    const failedTasks = job.tasks.filter((t) => failedIds.has(t.id));
    const tasksToRetry = failedTasks.length
      ? failedTasks
      : job.failures.map((f) => ({ id: f.id, title: f.title } as Task));

    // Remove the old failed job and start a new retry job
    get().dismissJob(jobId);
    get().startJob({
      title: `Retry: ${job.title}`,
      tasks: tasksToRetry,
      action: job.action,
    });
  },

  clearCompleted: () => {
    set((state) => ({
      jobs: state.jobs.filter((j) => j.status === 'running'),
    }));
  },
}));
