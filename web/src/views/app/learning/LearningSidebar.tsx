'use client';
import { useMemo, useState } from 'react';
import { useMyLearning, type MyLearningEntry } from '../../../hooks/useLms';

// Module side menu for the Learning section. Mirrors AppsSidebar conventions:
// a header, a search field, a status filter, and a scrollable list of items
// grouped by category. Clicking a row opens the item in the content panel.

type Tab = 'continue' | 'assigned' | 'completed' | 'catalog';

interface LearningSidebarProps {
  activeItemId: string | null;
  onSelectItem: (id: string) => void;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'continue', label: 'Continue' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'completed', label: 'Done' },
  { key: 'catalog', label: 'All' },
];

const UNCATEGORIZED = '__none__';

export default function LearningSidebar({ activeItemId, onSelectItem }: LearningSidebarProps) {
  const { data: assignments, isLoading } = useMyLearning();
  const [tab, setTab] = useState<Tab>('continue');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const all = assignments || [];

  const counts = useMemo(
    () => ({
      continue: all.filter((a) => a.status === 'in_progress').length,
      assigned: all.filter((a) => a.status === 'not_started').length,
      completed: all.filter((a) => a.status === 'completed').length,
      catalog: all.length,
    }),
    [all]
  );

  const visible = useMemo(() => {
    const byTab = all.filter((a) => {
      if (tab === 'continue') return a.status === 'in_progress';
      if (tab === 'assigned') return a.status === 'not_started';
      if (tab === 'completed') return a.status === 'completed';
      return true;
    });
    const q = query.trim().toLowerCase();
    if (!q) return byTab;
    return byTab.filter(
      (a) => a.item.title.toLowerCase().includes(q) || (a.item.summary || '').toLowerCase().includes(q)
    );
  }, [all, tab, query]);

  // Group the visible items by category, preserving a stable order.
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; color: string | null; items: MyLearningEntry[] }>();
    for (const entry of visible) {
      const cat = entry.item.category;
      const key = cat?.id || UNCATEGORIZED;
      if (!map.has(key)) {
        map.set(key, { name: cat?.name || 'General', color: cat?.color || null, items: [] });
      }
      map.get(key)!.items.push(entry);
    }
    return [...map.entries()]
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => {
        if (a.key === UNCATEGORIZED) return 1;
        if (b.key === UNCATEGORIZED) return -1;
        return a.name.localeCompare(b.name);
      });
  }, [visible]);

  const showGroupHeaders = groups.length > 1;

  return (
    <div className="flex h-full w-full flex-col text-[var(--sh-ink-2)]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--sh-hair)] px-4 py-3">
        <span
          className="grid h-[22px] w-[22px] place-items-center rounded-[6px] bg-[var(--sh-ink)] text-[var(--sidebar)]"
          style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', fontSize: 12, fontWeight: 700 }}
        >
          L
        </span>
        <span className="text-[13.5px] font-semibold text-[var(--sh-ink)]">Learning</span>
      </div>

      {/* Search */}
      <div className="px-3 pt-3">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--sh-ink-3)]"
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
            placeholder="Search learning…"
            className="w-full rounded-[8px] border border-[var(--sh-hair)] bg-[var(--surface)] py-[6px] pl-8 pr-2.5 text-[12.5px] text-[var(--sh-ink)] placeholder:text-[var(--sh-ink-3)] focus:border-[var(--sh-ink)] focus:outline-none"
          />
        </div>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-1">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[11.5px] transition ${
                active
                  ? 'bg-[var(--sh-ink)] font-medium text-[var(--sidebar)]'
                  : 'text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
              }`}
            >
              {t.label}
              <span className={`text-[10px] ${active ? 'opacity-70' : 'opacity-60'}`}>{counts[t.key]}</span>
            </button>
          );
        })}
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {isLoading ? (
          <p className="px-2 py-6 text-center text-[12px] text-[var(--sh-ink-3)]">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-[var(--sh-ink-3)]">
            {query.trim() ? 'No matches.' : emptyCopy(tab)}
          </p>
        ) : (
          groups.map((group) => {
            const isCollapsed = !!collapsed[group.key];
            return (
              <div key={group.key} className="pb-1">
                {showGroupHeaders && (
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] }))}
                    className="flex w-full items-center gap-1.5 px-2 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--sh-ink-3)] transition-colors hover:text-[var(--sh-ink)]"
                  >
                    <svg className={`h-3 w-3 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} viewBox="0 0 18 18" fill="currentColor">
                      <path d="M5 7h8L9 11z" />
                    </svg>
                    {group.color && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: group.color }} />}
                    <span className="truncate">{group.name}</span>
                  </button>
                )}
                {!isCollapsed &&
                  group.items.map((entry) => (
                    <ItemRow
                      key={entry.id}
                      entry={entry}
                      active={activeItemId === entry.item.id}
                      onClick={() => onSelectItem(entry.item.id)}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ItemRow({ entry, active, onClick }: { entry: MyLearningEntry; active: boolean; onClick: () => void }) {
  const { item, status, progress_percent } = entry;
  const done = status === 'completed';
  return (
    <button
      onClick={onClick}
      className={`mb-[1px] flex w-full items-center gap-2.5 rounded-[8px] px-2 py-[7px] text-left transition ${
        active
          ? 'border border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink)]'
          : 'border border-transparent text-[var(--sh-ink-2)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
      }`}
      style={active ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
    >
      {/* Thumbnail / icon */}
      {item.cover_image_url ? (
        <span className="h-9 w-9 shrink-0 overflow-hidden rounded-[7px] bg-[var(--sh-hair-3)]">
          <img src={item.cover_image_url} alt="" className="h-full w-full object-cover" />
        </span>
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[7px] bg-[var(--sh-hair-3)] text-[15px]">
          {item.kind === 'course' ? '📚' : '📝'}
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium leading-tight">{item.title}</span>
        </span>
        {done ? (
          <span className="flex items-center gap-1 text-[10.5px] font-medium text-emerald-600">
            <span className="grid h-3 w-3 place-items-center rounded-full bg-emerald-500 text-[7px] text-white">✓</span>
            Completed
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--sh-hair)]">
              <span className="block h-full rounded-full bg-[var(--sh-ink)]" style={{ width: `${progress_percent}%` }} />
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-[var(--sh-ink-3)]">{progress_percent}%</span>
          </span>
        )}
      </span>
    </button>
  );
}

function emptyCopy(tab: Tab) {
  switch (tab) {
    case 'continue':
      return 'Nothing in progress yet.';
    case 'assigned':
      return "You're all caught up.";
    case 'completed':
      return 'Nothing completed yet.';
    default:
      return 'No learning shared with you yet.';
  }
}
