import type { ReactNode } from 'react';
import './stage-row.css';
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
  stageCard = false,
}: {
  id: string;
  label: string;
  emoji?: string | null;
  color?: string | null;
  count: number;
  children: ReactNode;
  stageCard?: boolean;
}) {
  const collapsed = usePMStore((s) => s.collapsedGroups[id] ?? false);
  const setGroupCollapsed = usePMStore((s) => s.setGroupCollapsed);
  return (
    <section
      className={stageCard ? 'lv-section lv-stage-card' : 'lv-section'}
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

export type StageSectionStage = {
  key: string;
  label: string;
  emoji?: string | null;
  color?: string | null;
  /** Every pickable status of the stage, in workflow order. */
  statuses: { id: string; name: string; category?: string | null }[];
};

/**
 * List grouped by stage: a stage with tasks renders as a normal section with
 * one card per populated status and its empty statuses as chips at the foot;
 * a stage with no tasks shrinks to a slim row, in workflow order.
 */
export function StageSections<G>({
  scope,
  stages,
  groups,
  stageOf,
  statusIdOf,
  countOf,
  render,
  direction = 'asc',
  onAdd,
}: {
  scope: string;
  stages: StageSectionStage[];
  groups: G[];
  stageOf: (g: G) => string | null;
  statusIdOf: (g: G) => string;
  countOf: (g: G) => number;
  render: (g: G) => ReactNode;
  direction?: 'asc' | 'desc';
  onAdd?: (statusId: string) => void;
}) {
  const known = new Set(stages.map((s) => s.key));
  const ordered = direction === 'desc' ? [...stages].reverse() : stages;
  const leftovers = groups.filter((g) => !known.has(stageOf(g) || ''));
  return (
    <>
      {ordered.map((st) => {
        const items = groups.filter((g) => stageOf(g) === st.key && countOf(g) > 0);
        const statusLine = st.statuses.map((s) => s.name).join(' · ');
        if (items.length === 0) {
          return (
            <div key={st.key} className="stg-slim" style={{ ['--sec-color' as string]: st.color || 'var(--sh-ink-3)' }}>
              <span className="stg-slim-dot" />
              <span className="stg-slim-name">{st.label}</span>
              <span className="stg-slim-none">No tasks</span>
              <span className="stg-slim-line">{statusLine}</span>
              {onAdd && st.statuses[0] && (
                <button type="button" className="stg-slim-add" title={`Add a task in ${st.label}`} onClick={() => onAdd(st.statuses[0].id)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </button>
              )}
            </div>
          );
        }
        const used = new Set(items.map(statusIdOf));
        const empty = st.statuses.filter((s) => !used.has(s.id) && s.category !== 'closed' && s.category !== 'done');
        const shown = direction === 'desc' ? [...items].reverse() : items;
        return (
          <ListSection
            key={st.key}
            id={`${scope}:${st.key}`}
            label={st.label}
            emoji={st.emoji}
            color={st.color}
            count={items.reduce((n, g) => n + countOf(g), 0)}
            stageCard
          >
            {shown.map(render)}
            {empty.length > 0 && (
              <div className="stg-empty-chips">
                {empty.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="stg-empty-chip"
                    title={onAdd ? `Add a task in ${s.name}` : s.name}
                    onClick={onAdd ? () => onAdd(s.id) : undefined}
                  >
                    <span className="stg-empty-dot" />{s.name}<span className="stg-empty-n">0</span>
                  </button>
                ))}
              </div>
            )}
          </ListSection>
        );
      })}
      {leftovers.map(render)}
    </>
  );
}

/** Stage layout when the workflow has stages, plain sections otherwise. */
export function StageOrSectionGroups<G>({
  stages,
  stageOf,
  statusIdOf,
  onAdd,
  ...rest
}: Parameters<typeof SectionedGroups<G>>[0] & {
  stages: StageSectionStage[] | null;
  stageOf: (g: G) => string | null;
  statusIdOf: (g: G) => string;
  onAdd?: (statusId: string) => void;
}) {
  if (!stages || stages.length === 0) return <SectionedGroups {...rest} />;
  return (
    <StageSections
      scope={rest.scope}
      stages={stages}
      groups={rest.groups}
      stageOf={stageOf}
      statusIdOf={statusIdOf}
      countOf={rest.countOf}
      render={rest.render}
      direction={rest.direction}
      onAdd={onAdd}
    />
  );
}
