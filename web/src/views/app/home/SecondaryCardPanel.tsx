import { useEffect, useMemo, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { GROUP_BY_OPTIONS, groupTasks, collapseGroupedTasks, isGroupedRow } from '../../../lib/taskGrouping';
import DashboardTaskRow from './DashboardTaskRow';
import GroupedTaskRow from './GroupedTaskRow';
import type { SecondaryCardConfig } from './SecondaryCardRow';

// Shared full group-by set (None, Work date, Due date, Priority, Status,
// Space, Folder, List) — same options as the Focus list, Home tabs and
// Space/Folder views.
const GROUP_OPTIONS = GROUP_BY_OPTIONS;

// Slide-in lister opened when a Home "disappearing card" is clicked. Mirrors
// DashboardListPanel's mount / Escape / backdrop behaviour, header, group-by
// pills and row UI exactly: rows are DashboardTaskRow (same overdue/priority/
// path/avatar display) and open via the peek slot so the lister stays open
// behind the task detail — the layout in the design reference.
export default function SecondaryCardPanel({ card }: { card: SecondaryCardConfig | null }) {
  const setActiveSecondaryCard = usePMStore((s) => s.setActiveSecondaryCard);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  // Group-by is a persisted per-card preference (synced via view-preferences),
  // so the choice sticks across refresh and devices instead of resetting.
  const groupBy = usePMStore((s) => (card ? s.secondaryCardGroupBy[card.key] ?? 'none' : 'none'));
  const setSecondaryCardGroupBy = usePMStore((s) => s.setSecondaryCardGroupBy);
  const groupedExpanded = usePMStore((s) => s.groupedExpanded);
  const toggleGroupedExpanded = usePMStore((s) => s.toggleGroupedExpanded);
  const setActiveSpace = usePMStore((s) => s.setActiveSpace);
  const setActiveSpacePage = usePMStore((s) => s.setActiveSpacePage);
  const setActiveList = usePMStore((s) => s.setActiveList);
  const setActiveFolder = usePMStore((s) => s.setActiveFolder);
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const open = !!card;

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }
    setMounted(false);
    setScrolled(false);
    return undefined;
  }, [open ]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      // Let the task detail (peek or main) close first — otherwise Escape
      // would dismiss both the task and this lister in the same tick.
      const st = usePMStore.getState();
      if (st.peekTaskId || st.activeTaskId || st.groupRunPanel) return;
      setActiveSecondaryCard(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setActiveSecondaryCard]);

  const items = card?.data.items ?? [];
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const tasks = useMemo(() => items.map((it) => it.task), [items]);

  // Open a grouped container in PM; closing this panel first. Setting the active
  // id triggers MainLayout's nav effects to switch to that list/folder/space.
  const openContainer = (c: { type: 'list' | 'folder' | 'space'; id: string }) => {
    setActiveSecondaryCard(null);
    if (c.type === 'list') setActiveList(c.id);
    else if (c.type === 'folder') setActiveFolder(c.id);
    else { setActiveSpace(c.id); setActiveSpacePage(c.id); }
  };

  const renderTaskRows = (list: Task[]) =>
    collapseGroupedTasks(list).map((item) =>
      isGroupedRow(item) ? (
        <GroupedTaskRow
          key={`grp:${item.key}`}
          row={item}
          expanded={!!groupedExpanded[item.key]}
          onToggle={() => toggleGroupedExpanded(item.key)}
          onOpenContainer={openContainer}
          renderChild={(t) => <DashboardTaskRow key={t.id} task={t} />}
        />
      ) : (
        <DashboardTaskRow key={item.id} task={item} />
      ),
    );

  const groups = useMemo(() => {
    if (groupBy === 'none') return [];
    return groupTasks(tasks, groupBy, tz, fadingTaskIds);
  }, [tasks, groupBy, tz, fadingTaskIds]);

  // One-line shape of the bucket: count, urgent count, oldest overdue age —
  // same format as DashboardListPanel ("24 tasks · 24 urgent · oldest 142d").
  const summary = useMemo(() => {
    if (!card || card.data.isLoading || tasks.length === 0) return null;
    const urgent = tasks.filter((t) => (t as any).priority === 'urgent').length;
    const todayMid = new Date();
    todayMid.setHours(0, 0, 0, 0);
    let oldest = 0;
    for (const t of tasks) {
      const candidates = [t.due_date, t.work_date, t.start_date].filter(Boolean) as string[];
      if (candidates.length === 0) continue;
      const overdueIso = candidates
        .map((iso) => ({ iso, d: new Date(iso) }))
        .filter(({ d }) => { const dd = new Date(d); dd.setHours(0, 0, 0, 0); return dd.getTime() < todayMid.getTime(); })
        .sort((a, b) => a.d.getTime() - b.d.getTime())[0]?.iso
        ?? (t.due_date || t.work_date || t.start_date) as string;
      const d = new Date(overdueIso);
      d.setHours(0, 0, 0, 0);
      const days = Math.round((todayMid.getTime() - d.getTime()) / 86_400_000);
      if (days > oldest) oldest = days;
    }
    return { count: tasks.length, urgent, oldest };
  }, [card, tasks]);

  if (!card) return null;

  const isLoading = card.data.isLoading;
  const close = () => setActiveSecondaryCard(null);
  const dashScopeKey = `secondary:${card.key}`;

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="hmp-backdrop" style={{ opacity: mounted ? 1 : 0 }} onClick={close} />

      <aside
        onClick={(e) => e.stopPropagation()}
        className="hmp"
        style={{
          transform: mounted ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          transition: 'transform .42s cubic-bezier(0.23, 1, 0.32, 1), opacity .3s ease',
          opacity: mounted ? 1 : 0,
        }}
      >
        <div className="hmp-head">
          <button type="button" onClick={close} className="hmp-close" title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
            </svg>
          </button>
          <div className="hmp-head-text">
            <div className="hmp-eyebrow">{card.eyebrow}</div>
            <h3 className="hmp-title">{card.name}</h3>
            {summary && (
              <div className="hmp-summary">
                {summary.count} {summary.count === 1 ? 'task' : 'tasks'}
                {summary.urgent > 0 && (
                  <>
                    {' · '}
                    <span className="urgent">{summary.urgent} urgent</span>
                  </>
                )}
                {summary.oldest > 0 && ` · oldest ${summary.oldest}d`}
              </div>
            )}
          </div>
          <div className="hmp-head-actions">
            <kbd className="hmp-kbd" title="Press Escape to close">esc</kbd>
          </div>
        </div>

        <div className="hmp-groupby" data-scrolled={scrolled}>
          <span className="glbl">Group by</span>
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="hm-pill"
              data-active={groupBy === opt.value}
              onClick={() => dashScopeKey && setSecondaryCardGroupBy(card.key, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div
          className="hmp-scroll sh-view"
          onScroll={(e) => setScrolled((e.currentTarget as HTMLDivElement).scrollTop > 2)}
        >
          {isLoading ? (
            <div className="hmp-list" aria-hidden="true">
              <div className="hm-skel" />
              <div className="hm-skel" style={{ animationDelay: '0.15s' }} />
              <div className="hm-skel" style={{ animationDelay: '0.3s' }} />
            </div>
          ) : tasks.length === 0 ? (
            <div className="hmp-center">
              <div className="hm-empty">
                <div className="rule" />
                <div className="h">Nothing here right now.</div>
                <div className="p">Tasks appear here as they match this card.</div>
              </div>
            </div>
          ) : groupBy === 'none' ? (
            <div className="hmp-list">
              {renderTaskRows(tasks)}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="hm-group">
                <div className="hm-group-head">
                  {g.color && (
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: g.color, flex: 'none' }} />
                  )}
                  <span>{g.label}</span>
                  <span className="count">· {g.tasks.length}</span>
                </div>
                <div className="hmp-list" style={{ paddingTop: 0 }}>
                  {renderTaskRows(g.tasks)}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
