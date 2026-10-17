import { useBulkTaskStore, type BulkTaskJob } from '../../../stores/bulkTaskStore';
import './bulk-tasks.css';

export function BulkJobCard({ job }: { job: BulkTaskJob }) {
  const dismissJob = useBulkTaskStore((s) => s.dismissJob);
  const toggleErrors = useBulkTaskStore((s) => s.toggleErrors);
  const retryJob = useBulkTaskStore((s) => s.retryJob);

  const pct = job.total > 0 ? Math.min(100, Math.round((job.completed / job.total) * 100)) : 100;
  const isRunning = job.status === 'running';
  const hasFailures = job.failures.length > 0;

  return (
    <div className="bulk-job-card" role="status" aria-live="polite">
      <div className="bulk-job-header">
        <div className="bulk-job-left">
          {isRunning ? (
            <svg className="bulk-icon bulk-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          ) : hasFailures ? (
            <svg className="bulk-icon bulk-warn" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg className="bulk-icon bulk-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span className="bulk-job-title" title={job.title}>{job.title}</span>
        </div>

        <div className="bulk-job-right">
          <span className="bulk-job-count">
            {job.completed}/{job.total} ({pct}%)
          </span>
          {hasFailures && (
            <button
              type="button"
              className="bulk-job-err-toggle"
              onClick={() => toggleErrors(job.id)}
              aria-expanded={job.expandedErrors}
              title="Toggle error details"
            >
              <span>⚠ {job.failures.length} failed</span>
              <span className="bulk-chev">{job.expandedErrors ? '▴' : '▾'}</span>
            </button>
          )}
          <button
            type="button"
            className="bulk-job-dismiss"
            onClick={() => dismissJob(job.id)}
            aria-label="Dismiss job notification"
          >
            ×
          </button>
        </div>
      </div>

      <div className="bulk-progress-track">
        <div
          className={`bulk-progress-fill ${job.status} ${hasFailures ? 'has-failures' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {hasFailures && job.expandedErrors && (
        <div className="bulk-job-error-drawer">
          <div className="bulk-job-error-list">
            {job.failures.map((f, i) => (
              <div key={`${f.id}-${i}`} className="bulk-job-error-item">
                <span className="error-title">{f.title || 'Task'}</span>
                <span className="error-msg">{f.message}</span>
              </div>
            ))}
          </div>
          <div className="bulk-job-error-actions">
            <button
              type="button"
              className="bulk-job-retry-btn"
              onClick={() => retryJob(job.id)}
            >
              Retry {job.failures.length} failed
            </button>
            <button
              type="button"
              className="bulk-job-dismiss-btn"
              onClick={() => dismissJob(job.id)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BulkTaskDock() {
  const jobs = useBulkTaskStore((s) => s.jobs);
  if (!jobs.length) return null;
  return (
    <div className="bulk-jobs-stack">
      {jobs.map((job) => (
        <BulkJobCard key={job.id} job={job} />
      ))}
    </div>
  );
}
