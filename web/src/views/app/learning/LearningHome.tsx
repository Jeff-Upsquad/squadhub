'use client';
import { useState, useMemo } from 'react';
import { useMyLearning, useLmsCategories, type MyLearningEntry } from '../../../hooks/useLms';

type Tab = 'continue' | 'assigned' | 'completed' | 'catalog';

export default function LearningHome({ onOpenItem }: { onOpenItem: (id: string) => void }) {
  const { data: assignments, isLoading } = useMyLearning();
  const { data: categories } = useLmsCategories();
  const [tab, setTab] = useState<Tab>('continue');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  const grouped = useMemo(() => {
    const all = assignments || [];
    return {
      continue: all.filter((a) => a.status === 'in_progress'),
      assigned: all.filter((a) => a.status === 'not_started'),
      completed: all.filter((a) => a.status === 'completed'),
      catalog: all,
    };
  }, [assignments]);

  const visible = (grouped[tab] || []).filter((a) => {
    if (!categoryFilter) return true;
    return a.item.category_id === categoryFilter;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--sh-hair)] px-6 pt-5 pb-0">
        <h1 className="serif text-[32px] leading-tight text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', letterSpacing: '-0.01em' }}>
          Learning
        </h1>
        <p className="mt-1 text-[13px] text-[var(--sh-ink-3)]">Training and updates assigned to you.</p>

        <div className="mt-4 flex items-center gap-1 border-b border-transparent">
          <TabButton label="Continue" count={grouped.continue.length} active={tab === 'continue'} onClick={() => setTab('continue')} />
          <TabButton label="Assigned" count={grouped.assigned.length} active={tab === 'assigned'} onClick={() => setTab('assigned')} />
          <TabButton label="Completed" count={grouped.completed.length} active={tab === 'completed'} onClick={() => setTab('completed')} />
          <TabButton label="All" count={grouped.catalog.length} active={tab === 'catalog'} onClick={() => setTab('catalog')} />

          {(categories && categories.length > 0) && (
            <div className="ml-auto pb-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-full border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-1 text-[12px] text-[var(--sh-ink-2)] focus:border-[var(--sh-ink)] focus:outline-none"
              >
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <p className="text-sm text-[var(--sh-ink-3)]">Loading…</p>
        ) : visible.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((a) => (
              <LearningCard key={a.id} entry={a} onClick={() => onOpenItem(a.item.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative px-3 py-2 text-[13px] transition ${
        active ? 'font-semibold text-[var(--sh-ink)]' : 'text-[var(--sh-ink-3)] hover:text-[var(--sh-ink-2)]'
      }`}
    >
      {label}
      <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        active ? 'bg-[var(--sh-ink)] text-[var(--sidebar)]' : 'bg-[var(--sh-hair-3)] text-[var(--sh-ink-3)]'
      }`}>
        {count}
      </span>
      {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[var(--sh-ink)]" />}
    </button>
  );
}

function LearningCard({ entry, onClick }: { entry: MyLearningEntry; onClick: () => void }) {
  const { item, status, progress_percent } = entry;
  return (
    <button
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] text-left transition hover:border-[var(--sh-ink-3)] hover:shadow-[var(--sh-shadow-sm)]"
    >
      {item.cover_image_url ? (
        <div className="aspect-[16/9] w-full overflow-hidden bg-[var(--sh-hair-3)]">
          <img src={item.cover_image_url} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        </div>
      ) : (
        <div className="flex aspect-[16/9] w-full items-center justify-center bg-gradient-to-br from-[var(--sh-hair-3)] to-[var(--sh-hair)]">
          <span className="serif text-3xl text-[var(--sh-ink-3)]" style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)' }}>
            {item.kind === 'course' ? '📚' : '📝'}
          </span>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[var(--sh-hair-3)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--sh-ink-3)]">
            {item.kind}
          </span>
          {(item as any).category && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--sh-ink-3)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: (item as any).category.color }} />
              {(item as any).category.name}
            </span>
          )}
        </div>
        <h3 className="font-[family-name:var(--font-display)] text-[15px] font-semibold leading-tight text-[var(--sh-ink)]">
          {item.title}
        </h3>
        {item.summary && <p className="text-[12.5px] leading-snug text-[var(--sh-ink-3)] line-clamp-2">{item.summary}</p>}

        <div className="mt-auto flex items-center gap-2 pt-2">
          <div className="flex-1">
            <div className="h-1 overflow-hidden rounded-full bg-[var(--sh-hair)]">
              <div
                className={`h-full ${status === 'completed' ? 'bg-emerald-500' : 'bg-[var(--sh-ink)]'}`}
                style={{ width: `${progress_percent}%` }}
              />
            </div>
          </div>
          <span className="text-[11px] text-[var(--sh-ink-3)]">
            {status === 'completed' ? '✓ Completed' : `${progress_percent}%`}
          </span>
        </div>
      </div>
    </button>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const copy = {
    continue: { title: 'Nothing in progress', body: 'Start a lesson from "Assigned" and it\'ll show up here.' },
    assigned: { title: 'No new assignments', body: 'You\'re all caught up — new content will appear here when an admin publishes.' },
    completed: { title: 'Nothing completed yet', body: 'Finish a lesson and it\'ll show up here.' },
    catalog: { title: 'Nothing here', body: 'No learning content has been shared with you yet.' },
  }[tab];
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--sh-hair-3)]">
        <svg className="h-6 w-6 text-[var(--sh-ink-3)]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </div>
      <h3 className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-[var(--sh-ink)]">{copy.title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-[var(--sh-ink-3)]">{copy.body}</p>
    </div>
  );
}
