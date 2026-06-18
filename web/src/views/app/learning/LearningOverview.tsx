'use client';
import { useMemo } from 'react';
import { useMyLearning, type MyLearningEntry } from '../../../hooks/useLms';

// Content-panel landing shown when no learning item is selected. Gives an
// at-a-glance summary plus quick entry points, so the panel never sits empty.
export default function LearningOverview({ onSelectItem }: { onSelectItem: (id: string) => void }) {
  const { data: assignments, isLoading } = useMyLearning();
  const all = assignments || [];

  const { inProgress, assigned, completed } = useMemo(
    () => ({
      inProgress: all.filter((a) => a.status === 'in_progress'),
      assigned: all.filter((a) => a.status === 'not_started'),
      completed: all.filter((a) => a.status === 'completed'),
    }),
    [all]
  );

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--sh-ink-3)]">Loading…</div>;
  }

  if (all.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--sh-hair-3)]">
          <svg className="h-6 w-6 text-[var(--sh-ink-3)]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
        <h3 className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-[var(--sh-ink)]">No learning yet</h3>
        <p className="mt-1 max-w-sm text-[13px] text-[var(--sh-ink-3)]">
          Training and updates shared with you will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8 md:py-10">
        {/* Hero */}
        <header className="border-b border-[var(--sh-hair)] pb-6">
          <h1
            className="serif text-[36px] leading-tight text-[var(--sh-ink)]"
            style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', letterSpacing: '-0.01em' }}
          >
            Learning
          </h1>
          <p className="mt-1 text-[13px] text-[var(--sh-ink-3)]">Training and updates assigned to you.</p>

          {/* Stat strip */}
          <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--sh-hair)] bg-[var(--sh-hair)]">
            <Stat label="In progress" value={inProgress.length} />
            <Stat label="Assigned" value={assigned.length} />
            <Stat label="Completed" value={completed.length} accent="emerald" />
          </div>
        </header>

        {inProgress.length > 0 && (
          <Section title="Continue where you left off" entries={inProgress} onSelectItem={onSelectItem} />
        )}
        {assigned.length > 0 && <Section title="Assigned to you" entries={assigned} onSelectItem={onSelectItem} />}
        {inProgress.length === 0 && assigned.length === 0 && (
          <p className="mt-10 text-center text-[13px] text-[var(--sh-ink-3)]">
            🎉 You&apos;re all caught up. Pick anything from the list to revisit it.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: 'emerald' }) {
  return (
    <div className="bg-[var(--surface)] px-4 py-3">
      <div className={`serif text-[26px] leading-none ${accent === 'emerald' ? 'text-emerald-600' : 'text-[var(--sh-ink)]'}`} style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)' }}>
        {value}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-wider text-[var(--sh-ink-3)]">{label}</div>
    </div>
  );
}

function Section({
  title,
  entries,
  onSelectItem,
}: {
  title: string;
  entries: MyLearningEntry[];
  onSelectItem: (id: string) => void;
}) {
  return (
    <section className="mt-7">
      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {entries.slice(0, 6).map((entry) => (
          <OverviewCard key={entry.id} entry={entry} onClick={() => onSelectItem(entry.item.id)} />
        ))}
      </div>
    </section>
  );
}

function OverviewCard({ entry, onClick }: { entry: MyLearningEntry; onClick: () => void }) {
  const { item, status, progress_percent } = entry;
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] p-3 text-left transition hover:border-[var(--sh-ink-3)] hover:shadow-[var(--sh-shadow-sm)]"
    >
      {item.cover_image_url ? (
        <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--sh-hair-3)]">
          <img src={item.cover_image_url} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
        </span>
      ) : (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[var(--sh-hair-3)] text-xl">
          {item.kind === 'course' ? '📚' : '📝'}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-[var(--sh-hair-3)] px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">
            {item.kind}
          </span>
          {item.category && (
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.category.color }} />
          )}
        </span>
        <span className="truncate text-[13.5px] font-semibold leading-tight text-[var(--sh-ink)]">{item.title}</span>
        <span className="flex items-center gap-2 pt-0.5">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--sh-hair)]">
            <span
              className={`block h-full rounded-full ${status === 'completed' ? 'bg-emerald-500' : 'bg-[var(--sh-ink)]'}`}
              style={{ width: `${progress_percent}%` }}
            />
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-[var(--sh-ink-3)]">
            {status === 'completed' ? '✓' : `${progress_percent}%`}
          </span>
        </span>
      </span>
    </button>
  );
}
