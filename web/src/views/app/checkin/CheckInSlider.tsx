import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../../services/api';
import type { CheckInConfigItem } from '@squadhub/shared';

interface Props {
  checklistItems: CheckInConfigItem[];
  onClose: () => void;
  onSuccess: () => void;
}

type ResultStatus = 'on_time' | 'late' | 'error' | 'already' | null;

export default function CheckInSlider({ checklistItems, onClose, onSuccess }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ResultStatus>(null);

  const requiredIds = checklistItems.filter((i) => i.isRequired).map((i) => i.id);
  const allRequiredChecked = requiredIds.every((id) => checked.has(id));

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post('/checkin/submit', { completed_items: Array.from(checked) }).then((r) => r.data),
    onSuccess: (data) => {
      setResult(data.data.status === 'on_time' ? 'on_time' : 'late');
      setTimeout(() => {
        onSuccess();
      }, 2000);
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        setResult('already');
        setTimeout(() => { onSuccess(); }, 2000);
      } else {
        setResult('error');
      }
    },
  });

  // Close on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />

      {/* Slider panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col bg-surface shadow-xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">
            Daily Check-In
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-foreground-dim transition hover:bg-surface-alt hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Result popup */}
        {result && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/95">
            <div className="text-center">
              {result === 'on_time' && (
                <>
                  <div className="mb-3 text-5xl">&#9989;</div>
                  <h3 className="text-lg font-semibold text-emerald-700">Check-In Successful</h3>
                  <p className="mt-1 text-sm text-foreground-muted">Submitted on time. Great job!</p>
                </>
              )}
              {result === 'late' && (
                <>
                  <div className="mb-3 text-5xl">&#128336;</div>
                  <h3 className="text-lg font-semibold text-yellow-700">Late Check-In</h3>
                  <p className="mt-1 text-sm text-foreground-muted">Submitted after the deadline.</p>
                </>
              )}
              {result === 'already' && (
                <>
                  <div className="mb-3 text-5xl">&#9989;</div>
                  <h3 className="text-lg font-semibold text-foreground">Already Checked In</h3>
                  <p className="mt-1 text-sm text-foreground-muted">You have already checked in today.</p>
                </>
              )}
              {result === 'error' && (
                <>
                  <div className="mb-3 text-5xl">&#10060;</div>
                  <h3 className="text-lg font-semibold text-red-700">Check-In Failed</h3>
                  <p className="mt-1 text-sm text-foreground-muted">A server error occurred. Please try again.</p>
                  <button
                    onClick={() => setResult(null)}
                    className="mt-4 rounded-lg border border-divider px-4 py-2 text-sm text-foreground-muted hover:bg-surface-alt"
                  >
                    Try Again
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Checklist */}
        <div className="flex-1 overflow-y-auto p-5">
          {checklistItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-foreground-dim">No checklist items configured for your role.</p>
              <p className="mt-1 text-xs text-foreground-dim">You can still submit an empty check-in.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {checklistItems
                .sort((a, b) => a.order - b.order)
                .map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-divider p-3 transition hover:bg-surface-alt"
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="mt-0.5 h-4 w-4 rounded border-divider text-foreground focus:ring-accent"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{item.label}</span>
                        {item.isRequired && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-500 dark:bg-red-500/15 dark:text-red-300">
                            Required
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="mt-0.5 text-xs text-foreground-dim">{item.description}</p>
                      )}
                    </div>
                  </label>
                ))}
            </div>
          )}
        </div>

        {/* Submit button */}
        <div className="border-t border-divider p-5">
          <button
            onClick={() => submitMutation.mutate()}
            disabled={!allRequiredChecked || submitMutation.isPending}
            className="w-full rounded-lg bg-sh-ink py-2.5 text-sm font-medium text-surface transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitMutation.isPending ? 'Submitting...' : 'Submit Check-In'}
          </button>
          {!allRequiredChecked && requiredIds.length > 0 && (
            <p className="mt-2 text-center text-xs text-red-400">Complete all required items to submit</p>
          )}
        </div>
      </div>
    </>
  );
}
