import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

type RequestType = 'half_day' | 'full_day' | 'long_term';

const TYPE_LABELS: Record<RequestType, string> = {
  half_day: 'Half Day',
  full_day: 'Full Day',
  long_term: 'Long Term',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  approved: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  rejected: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
};

export default function OffDaysTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [requestType, setRequestType] = useState<RequestType>('full_day');
  const [date, setDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const { data: res, isLoading } = useQuery({
    queryKey: ['off-day-requests'],
    queryFn: () => api.get('/off-days').then((r) => r.data),
  });

  const requests = res?.data || [];

  const submitMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/off-days', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['off-day-requests'] });
      resetForm();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/off-days/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['off-day-requests'] });
    },
  });

  function resetForm() {
    setShowForm(false);
    setRequestType('full_day');
    setDate('');
    setStartDate('');
    setEndDate('');
    setReason('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { request_type: requestType, reason };
    if (requestType === 'half_day' || requestType === 'full_day') {
      body.date = date;
    } else {
      body.start_date = startDate;
      body.end_date = endDate;
    }
    submitMutation.mutate(body);
  }

  const canSubmit =
    requestType === 'long_term'
      ? !!startDate && !!endDate && endDate >= startDate
      : !!date;

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-[family-name:var(--font-display)] text-sm font-semibold text-foreground">
          Off Days
        </h3>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-sh-ink px-3 py-1.5 text-xs font-medium text-surface transition hover:opacity-90"
          >
            + Request Off Day
          </button>
        )}
      </div>

      {/* Request form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-divider bg-surface p-4 space-y-4"
        >
          {/* Type selector */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
              Type
            </label>
            <div className="flex gap-1.5">
              {(Object.keys(TYPE_LABELS) as RequestType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRequestType(t)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    requestType === t
                      ? 'bg-sh-ink text-surface'
                      : 'bg-surface-alt text-foreground-muted hover:bg-divider'
                  }`}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Date fields */}
          {requestType === 'long_term' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
                  From
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-divider px-3 py-2 text-xs text-foreground focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
                  To
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  className="w-full rounded-lg border border-divider px-3 py-2 text-xs text-foreground focus:border-accent focus:outline-none"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-divider px-3 py-2 text-xs text-foreground focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-foreground-dim">
              Reason (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-divider px-3 py-2 text-xs text-foreground placeholder:text-foreground-dim focus:border-accent focus:outline-none resize-none"
              placeholder="Why are you taking this day off?"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!canSubmit || submitMutation.isPending}
              className="rounded-lg bg-sh-ink px-4 py-2 text-xs font-medium text-surface transition hover:opacity-90 disabled:opacity-40"
            >
              {submitMutation.isPending ? 'Submitting...' : 'Submit Request'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg bg-surface-alt px-4 py-2 text-xs font-medium text-foreground-muted transition hover:bg-divider"
            >
              Cancel
            </button>
          </div>

          {submitMutation.isError && (
            <p className="text-xs text-red-500">Failed to submit. Please try again.</p>
          )}
        </form>
      )}

      {/* Requests list */}
      {isLoading ? (
        <p className="text-xs text-foreground-dim">Loading...</p>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center">
          <svg className="mb-3 h-10 w-10 text-divider" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <p className="text-xs text-foreground-dim">No off-day requests yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r: any) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-xl border border-divider bg-surface px-4 py-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
                    {TYPE_LABELS[r.request_type as RequestType] || r.request_type}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[r.status] || ''}`}>
                    {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                  </span>
                </div>
                <p className="text-xs text-foreground">
                  {r.request_type === 'long_term'
                    ? `${r.start_date} — ${r.end_date}`
                    : r.date}
                </p>
                {r.reason && (
                  <p className="text-[11px] text-foreground-dim">{r.reason}</p>
                )}
              </div>
              {r.status === 'pending' && (
                <button
                  onClick={() => cancelMutation.mutate(r.id)}
                  disabled={cancelMutation.isPending}
                  className="rounded-lg bg-red-50 px-3 py-1.5 text-[11px] font-medium text-red-600 transition hover:bg-red-100 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
