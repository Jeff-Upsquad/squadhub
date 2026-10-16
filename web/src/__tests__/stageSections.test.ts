import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StageOrSectionGroups, type StageSectionStage } from '../views/app/pm/ListSection';

vi.stubGlobal('React', React);
vi.mock('../stores/pmStore', () => ({
  usePMStore: (select: (state: unknown) => unknown) => select({ collapsedGroups: {}, setGroupCollapsed: vi.fn() }),
}));

const stages: StageSectionStage[] = [
  { key: 'planning', label: 'Planning', statuses: [{ id: 'plan', name: 'Plan' }, { id: 'discuss', name: 'Need discussion' }] },
  { key: 'in_motion', label: 'In progress', statuses: [{ id: 'front', name: 'Front burner' }] },
];
type Group = { id: string; stage: string; count: number };
const render = (groups: Group[], stageList: StageSectionStage[] | null = stages, direction: 'asc' | 'desc' = 'asc') => renderToStaticMarkup(
  React.createElement(StageOrSectionGroups<Group>, {
    scope: 'test', stages: stageList, groups, direction,
    sectionOf: () => null,
    stageOf: (g) => g.stage,
    statusIdOf: (g) => g.id,
    countOf: (g) => g.count,
    render: (g) => React.createElement('article', { key: g.id, 'data-status': g.id }, `${g.count} tasks`),
    onAdd: () => {},
  }),
);

describe('stage cards in list view', () => {
  it('keeps populated statuses together inside a single stage card', () => {
    const html = render([{ id: 'plan', stage: 'planning', count: 2 }, { id: 'discuss', stage: 'planning', count: 1 }]);
    expect(html.match(/lv-stage-card/g)).toHaveLength(1);
    expect(html).toContain('3 tasks');
    expect(html).toContain('data-status="plan"');
    expect(html).toContain('data-status="discuss"');
    expect(html).toContain('stg-slim-name">In progress');
  });

  it('shows unused statuses as chips and empty stages as slim rows', () => {
    const html = render([{ id: 'plan', stage: 'planning', count: 2 }]);
    expect(html).toContain('stg-empty-chip');
    expect(html).toContain('Add a task in Need discussion');
    expect(html).not.toContain('data-status="discuss"');
    expect(html).toContain('Add a task in In progress');
  });

  it('keeps every stage available when the list is empty', () => {
    const html = render([]);
    expect(html.match(/class="stg-slim"/g)).toHaveLength(2);
    expect(html).not.toContain('lv-stage-card');
  });

  it('reverses stage order without dropping tasks outside known stages', () => {
    const html = render([{ id: 'unknown', stage: 'custom', count: 1 }], stages, 'desc');
    expect(html.indexOf('In progress')).toBeLessThan(html.indexOf('Planning'));
    expect(html).toContain('data-status="unknown"');
  });

  it('preserves ordinary status cards for workflows without stages', () => {
    const html = render([{ id: 'todo', stage: '', count: 1 }], null);
    expect(html).toContain('data-status="todo"');
    expect(html).not.toContain('lv-stage-card');
    expect(html).not.toContain('stg-slim');
  });
});
