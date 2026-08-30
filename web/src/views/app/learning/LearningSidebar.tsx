'use client';
import { useMemo, useState } from 'react';
import { useMyLearning, useOpenSopTasks, type MyLearningEntry } from '../../../hooks/useLms';
import { useSharedWithMe } from '../../../hooks/useLmsCollab';

// Module side menu for the Resources section. Mirrors AppsSidebar conventions:
// a header, a search field, and a scrollable list of items grouped by category.
// Clicking a row opens the item in the content panel.
//
// The list is split into two clearly-labelled sections (see LmsTrack /
// migration 118):
//  - "Courses" — track 'learning' items the user is actively working through.
//    Only active courses (in progress / assigned) are listed; once a course is
//    completed it drops out of this section.
//  - "Systems and Procedures" — track 'sop' reference docs (e.g. "How to use
//    Inbox"). These never carry progress chrome.

interface LearningSidebarProps {
  activeItemId: string | null;
  onSelectItem: (id: string) => void;
}

const UNCATEGORIZED = '__none__';

interface Group {
  key: string;
  name: string;
  color: string | null;
  items: MyLearningEntry[];
}

// Group a set of entries by their item's category, preserving a stable
// (alphabetical, uncategorized-last) order. keyPrefix keeps the Courses and
// Systems-and-Procedures collapse-state namespaces from colliding when the same
// category id appears in both tracks.
function groupByCategory(entries: MyLearningEntry[], keyPrefix = ''): Group[] {
  const map = new Map<string, Group>();
  for (const entry of entries) {
    const cat = entry.item.category;
    const key = keyPrefix + (cat?.id || UNCATEGORIZED);
    if (!map.has(key)) {
      map.set(key, { key, name: cat?.name || 'General', color: cat?.color || null, items: [] });
    }
    map.get(key)!.items.push(entry);
  }
  return [...map.values()].sort((a, b) => {
    const au = a.key.endsWith(UNCATEGORIZED);
    const bu = b.key.endsWith(UNCATEGORIZED);
    if (au) return 1;
    if (bu) return -1;
    return a.name.localeCompare(b.name);
  });
}

export default function LearningSidebar({ activeItemId, onSelectItem }: LearningSidebarProps) {
  const { data: assignments, isLoading } = useMyLearning();
  const { data: openSopTasks } = useOpenSopTasks();
  const { data: shared } = useSharedWithMe();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const all = assignments || [];

  // Shared-but-unassigned items become synthetic entries so they render in the
  // catalog. Dedupe against assignments (assigned wins — it carries progress).
  const assignedIds = useMemo(() => new Set(all.map((a) => a.item.id)), [all]);
  const sharedEntries = useMemo<MyLearningEntry[]>(
    () =>
      (shared || [])
        .filter((s) => !assignedIds.has(s.item.id))
        .map((s) => ({
          id: `shared-${s.item.id}`,
          item: s.item,
          status: 'not_started',
          progress_percent: 0,
        }) as MyLearningEntry),
    [shared, assignedIds],
  );

  const q = query.trim().toLowerCase();
  const matchesQuery = (a: MyLearningEntry) =>
    !q || a.item.title.toLowerCase().includes(q) || (a.item.summary || '').toLowerCase().includes(q);

  // Courses: active items only (anything not yet completed), search-filtered.
  // Completed courses drop out of the list.
  const courseVisible = useMemo(
    () => all.filter((a) => a.item.track !== 'sop' && a.status !== 'completed').filter(matchesQuery),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, q]
  );

  // Systems and Procedures: every SOP, search-filtered.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sopVisible = useMemo(() => all.filter((a) => a.item.track === 'sop').filter(matchesQuery), [all, q]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sharedVisible = useMemo(() => sharedEntries.filter(matchesQuery), [sharedEntries, q]);

  const courseGroups = useMemo(() => groupByCategory(courseVisible), [courseVisible]);
  const sopGroups = useMemo(() => groupByCategory(sopVisible, 'sop::'), [sopVisible]);
  const sharedGroups = useMemo(() => groupByCategory(sharedVisible, 'shared::'), [sharedVisible]);
  const taskCountByItem = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of openSopTasks || []) counts.set(task.item_id, (counts.get(task.item_id) || 0) + 1);
    return counts;
  }, [openSopTasks]);

  const nothing = courseVisible.length === 0 && sopVisible.length === 0 && sharedVisible.length === 0;

  return (
    <div className="flex h-full w-full flex-col text-[var(--sh-ink-2)]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--sh-hair)] px-4 py-3">
        <span
          className="grid h-[22px] w-[22px] place-items-center rounded-[6px] bg-[var(--sh-ink)] text-[var(--sidebar)]"
          style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', fontSize: 12, fontWeight: 700 }}
        >
          R
        </span>
        <span className="text-[13.5px] font-semibold text-[var(--sh-ink)]">Resources</span>
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
            placeholder="Search resources…"
            className="w-full rounded-[8px] border border-[var(--sh-hair)] bg-[var(--surface)] py-[6px] pl-8 pr-2.5 text-[12.5px] text-[var(--sh-ink)] placeholder:text-[var(--sh-ink-3)] focus:border-[var(--sh-ink)] focus:outline-none"
          />
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {isLoading ? (
          <p className="px-2 py-6 text-center text-[12px] text-[var(--sh-ink-3)]">Loading…</p>
        ) : nothing ? (
          <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-[var(--sh-ink-3)]">
            {q ? 'No matches.' : 'Nothing shared with you yet.'}
          </p>
        ) : (
          <>
            {/* Courses — active learning items, tab-free */}
            {courseGroups.length > 0 && (
              <Section
                icon={
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                }
                title="Courses"
              >
                <GroupList
                  groups={courseGroups}
                  collapsed={collapsed}
                  setCollapsed={setCollapsed}
                  activeItemId={activeItemId}
                  onSelectItem={onSelectItem}
                  taskCountByItem={taskCountByItem}
                />
              </Section>
            )}

            {/* Systems and Procedures — reference docs */}
            {sopGroups.length > 0 && (
              <Section
                className={courseGroups.length > 0 ? 'mt-3 border-t border-[var(--sh-hair)] pt-3' : ''}
                icon={
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z" />
                  </svg>
                }
                title="Systems and Procedures"
              >
                <GroupList
                  groups={sopGroups}
                  collapsed={collapsed}
                  setCollapsed={setCollapsed}
                  activeItemId={activeItemId}
                  onSelectItem={onSelectItem}
                  taskCountByItem={taskCountByItem}
                />
              </Section>
            )}

            {/* Shared with me — items shared directly or via a role (no assignment) */}
            {sharedGroups.length > 0 && (
              <Section
                className={courseGroups.length > 0 || sopGroups.length > 0 ? 'mt-3 border-t border-[var(--sh-hair)] pt-3' : ''}
                icon={
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                  </svg>
                }
                title="Shared with me"
              >
                <GroupList
                  groups={sharedGroups}
                  collapsed={collapsed}
                  setCollapsed={setCollapsed}
                  activeItemId={activeItemId}
                  onSelectItem={onSelectItem}
                  taskCountByItem={taskCountByItem}
                />
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// A labelled section block (Courses / Systems and Procedures) with an icon header.
function Section({
  icon,
  title,
  className,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--sh-ink-3)]">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function GroupList({
  groups,
  collapsed,
  setCollapsed,
  activeItemId,
  onSelectItem,
  taskCountByItem,
}: {
  groups: Group[];
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  activeItemId: string | null;
  onSelectItem: (id: string) => void;
  taskCountByItem: Map<string, number>;
}) {
  const showGroupHeaders = groups.length > 1;
  return (
    <>
      {groups.map((group) => {
        const isCollapsed = !!collapsed[group.key];
        return (
          <div key={group.key} className="pb-1">
            {showGroupHeaders && (
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] }))}
                className="flex w-full items-center gap-1.5 px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--sh-ink-3)] transition-colors hover:text-[var(--sh-ink)]"
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
                  taskCount={taskCountByItem.get(entry.item.id) || 0}
                />
              ))}
          </div>
        );
      })}
    </>
  );
}

function ItemRow({ entry, active, onClick, taskCount }: { entry: MyLearningEntry; active: boolean; onClick: () => void; taskCount: number }) {
  const { item, status, progress_percent } = entry;
  const isSop = item.track === 'sop';
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
          {isSop ? '📄' : item.kind === 'course' ? '📚' : '📝'}
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium leading-tight">{item.title}</span>
          {isSop && taskCount > 0 && <TaskCountBadge count={taskCount} />}
        </span>
        {/* SOPs are reference docs — show a short subtitle instead of progress chrome. */}
        {isSop ? (
          item.summary ? (
            <span className="truncate text-[10.5px] leading-tight text-[var(--sh-ink-3)]">{item.summary}</span>
          ) : null
        ) : done ? (
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

function TaskCountBadge({ count }: { count: number }) {
  return (
    <span
      className="grid h-[17px] min-w-[17px] shrink-0 place-items-center rounded-full bg-[var(--sh-badge-alert,#dc4c3e)] px-1 text-[9.5px] font-semibold leading-none text-white"
      aria-label={`${count} open ${count === 1 ? 'task' : 'tasks'}`}
    >
      {count}
    </span>
  );
}
