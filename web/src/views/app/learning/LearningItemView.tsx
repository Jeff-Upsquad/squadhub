'use client';
import { useEffect } from 'react';
import { useLmsItem, useStartAssignment } from '../../../hooks/useLms';
import PostView from './PostView';
import CourseView from './CourseView';

export default function LearningItemView({ itemId, onBack }: { itemId: string; onBack: () => void }) {
  const { data, isLoading } = useLmsItem(itemId);
  const start = useStartAssignment();

  // Mark in_progress on first open (if still not_started)
  useEffect(() => {
    if (data?.assignment && data.assignment.status === 'not_started') {
      start.mutate(data.assignment.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.assignment?.id]);

  if (isLoading || !data) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--sh-ink-3)]">Loading…</div>;
  }

  const { item, assignment } = data;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar — back returns to the overview (desktop) or the list (mobile) */}
      <div className="flex items-center gap-2 border-b border-[var(--sh-hair)] px-4 py-2.5">
        <button
          onClick={onBack}
          title="Back to learning"
          aria-label="Back to learning"
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="truncate text-[12.5px] font-medium text-[var(--sh-ink)]">{item.title}</span>
        {assignment && item.track !== 'sop' && (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-[var(--sh-ink-3)]">{assignment.progress_percent}%</span>
            <div className="h-1 w-24 overflow-hidden rounded-full bg-[var(--sh-hair)]">
              <div className={`h-full ${assignment.status === 'completed' ? 'bg-emerald-500' : 'bg-[var(--sh-ink)]'}`} style={{ width: `${assignment.progress_percent}%` }} />
            </div>
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {item.kind === 'post' ? (
          <PostView item={item as any} assignment={assignment} />
        ) : (
          <CourseView item={item as any} assignment={assignment} />
        )}
      </div>
    </div>
  );
}
