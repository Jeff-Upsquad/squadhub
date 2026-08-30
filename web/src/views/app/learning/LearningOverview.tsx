'use client';
import { useMemo } from 'react';
import { useMyLearning, useLmsSearch, useOpenSopTasks, type MyLearningEntry, type LmsSearchHit } from '../../../hooks/useLms';

// The Resources "web page": an at-a-glance catalog plus a cross-content search
// that returns inline results (item titles, page titles and page body text)
// which deep-link straight to the matching page. `query` is lifted to the shell
// so returning from an item keeps the same results.
export default function LearningOverview({
  query,
  setQuery,
  onSelectItem,
}: {
  query: string;
  setQuery: (q: string) => void;
  onSelectItem: (itemId: string, lessonId?: string | null) => void;
}) {
  const { data: assignments, isLoading } = useMyLearning();
  const { data: openSopTasks } = useOpenSopTasks();
  const all = assignments || [];
  const search = useLmsSearch(query);

  // Courses are track 'learning' (the active ones, i.e. not completed, drive the
  // "Courses" list); Systems and Procedures are track 'sop' reference docs.
  const { inProgress, assigned, completed, activeCourses, sops } = useMemo(() => {
    const learning = all.filter((a) => a.item.track !== 'sop');
    return {
      inProgress: learning.filter((a) => a.status === 'in_progress'),
      assigned: learning.filter((a) => a.status === 'not_started'),
      completed: learning.filter((a) => a.status === 'completed'),
      activeCourses: learning.filter((a) => a.status !== 'completed'),
      sops: all.filter((a) => a.item.track === 'sop'),
    };
  }, [all]);

  const q = query.trim().toLowerCase();
  const matches = (a: MyLearningEntry) =>
    !q || a.item.title.toLowerCase().includes(q) || (a.item.summary || '').toLowerCase().includes(q);
  const visibleCourses = useMemo(() => activeCourses.filter(matches), [activeCourses, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleSops = useMemo(() => sops.filter(matches), [sops, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const taskCountByItem = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of openSopTasks || []) counts.set(task.item_id, (counts.get(task.item_id) || 0) + 1);
    return counts;
  }, [openSopTasks]);

  const hasLearning = inProgress.length + assigned.length + completed.length > 0;

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--sh-ink-3)]">Loading…</div>;
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
            Resources
          </h1>
          <p className="mt-1 text-[13px] text-[var(--sh-ink-3)]">
            Courses, systems, procedures and learnings shared with you.
          </p>

          {/* Search — searches across everything in this section. */}
          <div className="relative mt-5">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sh-ink-3)]"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search courses, systems and procedures…"
              className="w-full rounded-[10px] border border-[var(--sh-hair)] bg-[var(--surface)] py-[10px] pl-10 pr-3 text-[13.5px] text-[var(--sh-ink)] placeholder:text-[var(--sh-ink-3)] focus:border-[var(--sh-ink)] focus:outline-none"
            />
          </div>

          {/* Stat strip — only relevant when there's course/post learning. */}
          {hasLearning && !q && (
            <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--sh-hair)] bg-[var(--sh-hair)]">
              <Stat label="In progress" value={inProgress.length} />
              <Stat label="Assigned" value={assigned.length} />
              <Stat label="Completed" value={completed.length} accent="emerald" />
            </div>
          )}
        </header>

        {/* Search mode — inline cross-content results that deep-link to a page. */}
        {q ? (
          <SearchResults query={query} hits={search.data || []} loading={search.isFetching} onSelectItem={onSelectItem} />
        ) : (
          <>
            {visibleCourses.length > 0 && (
              <Section title="Courses" entries={visibleCourses} onSelectItem={onSelectItem} taskCountByItem={taskCountByItem} />
            )}
            {visibleSops.length > 0 && (
              <Section title="Systems and Procedures" entries={visibleSops} onSelectItem={onSelectItem} taskCountByItem={taskCountByItem} />
            )}
            {all.length === 0 && (
              <p className="mt-10 text-center text-[13px] text-[var(--sh-ink-3)]">
                Courses, systems and procedures shared with you will appear here.
              </p>
            )}
            {all.length > 0 && visibleCourses.length === 0 && visibleSops.length === 0 && (
              <p className="mt-10 text-center text-[13px] text-[var(--sh-ink-3)]">
                🎉 You&apos;re all caught up. Search above to revisit anything shared with you.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cross-content search results                                        */
/* ------------------------------------------------------------------ */

const KIND_META: Record<string, { bg: string; label: string }> = {
  item: { bg: 'var(--sh-hair-3)', label: '' },
  page: { bg: '#eef3ff', label: 'Page' },
  text: { bg: '#f1f7f2', label: 'In page' },
};

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-amber-200 px-0.5 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function SearchResults({
  query, hits, loading, onSelectItem,
}: {
  query: string; hits: LmsSearchHit[]; loading: boolean;
  onSelectItem: (itemId: string, lessonId?: string | null) => void;
}) {
  const q = query.trim();
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold text-[var(--sh-ink)]">Search results</h2>
        <span className="text-[12.5px] text-[var(--sh-ink-3)]">
          {loading ? 'Searching…' : `${hits.length} for “${q}”`}
        </span>
      </div>
      {!loading && hits.length === 0 ? (
        <div className="mt-10 text-center text-[13px] text-[var(--sh-ink-3)]">
          <div className="mb-1 text-2xl">🔍</div>No matches. Try another term.
        </div>
      ) : (
        <ul className="space-y-1">
          {hits.map((h, i) => {
            const meta = KIND_META[h.match_kind] || KIND_META.text;
            return (
              <li key={`${h.item_id}-${h.lesson_id ?? 'item'}-${i}`}>
                <button
                  onClick={() => onSelectItem(h.item_id, h.lesson_id)}
                  className="flex w-full items-start gap-3 rounded-[12px] border border-transparent px-3 py-3 text-left transition hover:border-[var(--sh-hair)] hover:bg-[var(--sh-hair-3)]"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] text-[16px]" style={{ background: meta.bg }}>
                    {h.icon || (h.item_track === 'sop' ? '🗂️' : h.item_kind === 'post' ? '📣' : '📚')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-[var(--sh-ink)]">{highlight(h.title, q)}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--sh-ink-3)]">
                      {h.path.map((p, idx) => (
                        <span key={idx} className="flex items-center gap-1.5">
                          {idx > 0 && <span>›</span>}
                          <span className="rounded-[6px] bg-[var(--sh-hair-3)] px-1.5 py-px">{p}</span>
                        </span>
                      ))}
                    </span>
                    {h.snippet && <span className="mt-1 block text-[12.5px] leading-snug text-[var(--sh-ink-3)]">{highlight(h.snippet, q)}</span>}
                  </span>
                  {meta.label && (
                    <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">{meta.label}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
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
  taskCountByItem,
}: {
  title: string;
  entries: MyLearningEntry[];
  onSelectItem: (id: string) => void;
  taskCountByItem: Map<string, number>;
}) {
  return (
    <section className="mt-7">
      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--sh-ink-3)]">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {entries.slice(0, 6).map((entry) => (
          <OverviewCard key={entry.id} entry={entry} onClick={() => onSelectItem(entry.item.id)} taskCount={taskCountByItem.get(entry.item.id) || 0} />
        ))}
      </div>
    </section>
  );
}

function OverviewCard({ entry, onClick, taskCount }: { entry: MyLearningEntry; onClick: () => void; taskCount: number }) {
  const { item, status, progress_percent } = entry;
  const isSop = item.track === 'sop';
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
          {isSop ? '📄' : item.kind === 'course' ? '📚' : '📝'}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-[var(--sh-hair-3)] px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">
            {isSop ? 'Guide' : item.kind}
          </span>
          {item.category && (
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.category.color }} />
          )}
        </span>
        <span className="truncate text-[13.5px] font-semibold leading-tight text-[var(--sh-ink)]">{item.title}</span>
        {isSop && taskCount > 0 && (
          <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10.5px] font-semibold text-red-600">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            {taskCount} open {taskCount === 1 ? 'task' : 'tasks'}
          </span>
        )}
        {/* SOPs are reference docs — show a short summary instead of a progress bar. */}
        {isSop ? (
          item.summary ? (
            <span className="truncate text-[11.5px] leading-tight text-[var(--sh-ink-3)]">{item.summary}</span>
          ) : null
        ) : (
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
        )}
      </span>
    </button>
  );
}
