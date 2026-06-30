import { useEffect, useMemo, useRef, useState } from 'react';
import { usePMStore } from '../../../stores/pmStore';
import { groupTasks, type GroupBy } from '../../../lib/taskGrouping';
import type { SecondaryCardItem } from '../../../hooks/useSecondaryCards';
import type { SecondaryCardConfig } from './SecondaryCardRow';

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Due date' },
  { value: 'work_date', label: 'Work date' },
  { value: 'status', label: 'Status' },
  { value: 'space', label: 'Space' },
  { value: 'folder', label: 'Folder' },
  { value: 'list', label: 'List' },
];

// Slide-in list opened when a Home "disappearing card" is clicked. Mirrors
// DashboardListPanel's mount / Escape / backdrop behaviour and reuses its
// `.hmp*` styling. Purely presentational — it lists whatever items the active
// card's hook produced (already filtered to that card's rule).
export default function SecondaryCardPanel({ card }: { card: SecondaryCardConfig | null }) {
  const setActiveSecondaryCard = usePMStore((s) => s.setActiveSecondaryCard);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  // Group-by is a persisted per-card preference (synced via view-preferences),
  // so the choice sticks across refresh and devices instead of resetting.
  const groupBy = usePMStore((s) => (card ? s.secondaryCardGroupBy[card.key] ?? 'none' : 'none'));
  const setSecondaryCardGroupBy = usePMStore((s) => s.setSecondaryCardGroupBy);
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const open = !!card;

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }
    setMounted(false);
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      setActiveSecondaryCard(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setActiveSecondaryCard]);

  // Close the group-by menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const items = card?.data.items ?? [];
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  // When a group-by is active, group the underlying tasks then map each back to
  // its item row (keyed by task id) so the panel's row UI is reused verbatim.
  const groups = useMemo(() => {
    if (groupBy === 'none') return null;
    const byId = new Map(items.map((it) => [it.id, it] as const));
    return groupTasks(items.map((it) => it.task), groupBy, tz, fadingTaskIds)
      .map((g) => ({ key: g.key, label: g.label, items: g.tasks.map((t) => byId.get(t.id)).filter(Boolean) as SecondaryCardItem[] }));
  }, [items, groupBy, tz, fadingTaskIds]);

  if (!card) return null;

  const isLoading = card.data.isLoading;
  const overdueCount = items.filter((i) => i.overdue).length;
  const close = () => setActiveSecondaryCard(null);
  const currentLabel = GROUP_OPTIONS.find((o) => o.value === groupBy)?.label ?? 'None';

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
            {!isLoading && items.length > 0 && (
              <div className="hmp-summary">
                {items.length} {items.length === 1 ? 'item' : 'items'}
                {overdueCount > 0 && (
                  <>
                    {' · '}
                    <span className="urgent">{overdueCount} overdue</span>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="hmp-head-actions">
            {!isLoading && items.length > 0 && (
              <div ref={anchorRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="hm-pill"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <span className="dim">Group:</span>
                  {currentLabel}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="hm-menu" role="menu">
                    {GROUP_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="menuitem"
                        className="hm-menu-item"
                        data-active={groupBy === opt.value}
                        onClick={() => { setSecondaryCardGroupBy(card.key, opt.value); setMenuOpen(false); }}
                      >
                        <span>{opt.label}</span>
                        {groupBy === opt.value && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <kbd className="hmp-kbd" title="Press Escape to close">esc</kbd>
          </div>
        </div>

        <div className="hmp-scroll sh-view">
          {isLoading ? (
            <div className="hmp-list" aria-hidden="true">
              <div className="hm-skel" />
              <div className="hm-skel" style={{ animationDelay: '0.15s' }} />
              <div className="hm-skel" style={{ animationDelay: '0.3s' }} />
            </div>
          ) : items.length === 0 ? (
            <div className="hmp-center">
              <div className="hm-empty">
                <div className="rule" />
                <div className="h">Nothing here right now.</div>
                <div className="p">Tasks appear here as they match this card.</div>
              </div>
            </div>
          ) : groups ? (
            groups.map((g) => (
              <div key={g.key} className="hm-group">
                <div className="hm-group-head">
                  <span>{g.label}</span>
                  <span className="count">· {g.items.length}</span>
                </div>
                <div className="hmp-list" style={{ paddingTop: 0 }}>
                  {g.items.map((it) => (
                    <SecondaryRow key={it.id} item={it} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="hmp-list">
              {items.map((it) => (
                <SecondaryRow key={it.id} item={it} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function SecondaryRow({ item }: { item: SecondaryCardItem }) {
  const [fading, setFading] = useState(false);
  const clickable = !!item.open;

  const onToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.toggleDone) return;
    setFading(true);
    item.toggleDone();
  };

  return (
    <div
      className="hmp-task"
      data-fading={fading || undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => item.open!() : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.open!(); } } : undefined}
      style={clickable ? undefined : { cursor: 'default' }}
    >
      {item.toggleDone ? (
        <div
          className="checkbox"
          role="button"
          aria-label="Mark done"
          data-done={fading || undefined}
          data-celebrating={fading || undefined}
          onClick={onToggle}
        />
      ) : (
        <span className="sc-dot" aria-hidden="true" />
      )}
      <div className="body">
        <div className="title">{item.title}</div>
        {item.whenText && (
          <div className="meta">
            <span className="when" data-overdue={item.overdue || undefined}>{item.whenText}</span>
          </div>
        )}
      </div>
      <span />
      {clickable ? (
        <svg className="open-ind" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      ) : (
        <span />
      )}
    </div>
  );
}
