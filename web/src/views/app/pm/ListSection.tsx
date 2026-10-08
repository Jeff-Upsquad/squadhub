import type { ReactNode } from 'react';
import { usePMStore } from '../../../stores/pmStore';
import { sectionize, type ListSectionMeta } from '../../../lib/listSections';

/**
 * Render group cards under their sections (status picker section / task-type
 * group) when the grouping has them; otherwise render them flat.
 */
export function SectionedGroups<G>({
  scope,
  groups,
  sectionOf,
  countOf,
  render,
  order,
  direction = 'asc',
}: {
  /** Prefix for persisted collapse state, e.g. `lvsec:<listId>:status`. */
  scope: string;
  groups: G[];
  sectionOf: (g: G) => ListSectionMeta | null;
  countOf: (g: G) => number;
  render: (g: G) => ReactNode;
  order?: string[];
  /** 'desc' reverses the sections ("Other" stays last) and the groups inside each. */
  direction?: 'asc' | 'desc';
}) {
  const desc = direction === 'desc';
  const sections = sectionize(groups, sectionOf, order);
  if (!sections) return <>{(desc ? [...groups].reverse() : groups).map(render)}</>;
  // Descending flips real sections; the catch-all "Other" stays last.
  const ordered = desc
    ? [
      ...sections.filter((s) => s.section.key !== '__other__').reverse(),
      ...sections.filter((s) => s.section.key === '__other__'),
    ].map((s) => ({ ...s, items: [...s.items].reverse() }))
    : sections;
  return (
    <>
      {ordered.map(({ section, items }) => (
        <ListSection
          key={section.key}
          id={`${scope}:${section.key}`}
          label={section.label}
          emoji={section.emoji}
          color={section.color}
          count={items.reduce((n, g) => n + countOf(g), 0)}
        >
          {items.map(render)}
        </ListSection>
      ))}
    </>
  );
}

// Collapsible section heading above a run of List-view group cards
// (e.g. "🏃 Active" over IN DEV / CODE REVIEW / QA). Collapse state is kept
// in pmStore.collapsedGroups so it survives navigation like group cards do.
export default function ListSection({
  id,
  label,
  emoji,
  color,
  count,
  children,
}: {
  id: string;
  label: string;
  emoji?: string | null;
  color?: string | null;
  count: number;
  children: ReactNode;
}) {
  const collapsed = usePMStore((s) => s.collapsedGroups[id] ?? false);
  const setGroupCollapsed = usePMStore((s) => s.setGroupCollapsed);
  return (
    <section
      className="lv-section"
      data-collapsed={collapsed || undefined}
      style={{ ['--sec-color' as string]: color || 'var(--sh-ink-3)' }}
    >
      <button
        type="button"
        className="lv-section-head"
        aria-expanded={!collapsed}
        onClick={() => setGroupCollapsed(id, !collapsed)}
      >
        <svg className="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
        {emoji && <span className="emoji" aria-hidden>{emoji}</span>}
        <span className="label">{label}</span>
        <span className="count">{count} {count === 1 ? 'task' : 'tasks'}</span>
      </button>
      {!collapsed && <div className="lv-section-body">{children}</div>}
    </section>
  );
}
