import { useEffect, useState } from 'react';
import { usePMStore } from '../../../stores/pmStore';
import type { SecondaryCardItem } from '../../../hooks/useSecondaryCards';
import type { SecondaryCardConfig } from './SecondaryCardRow';

// Slide-in list opened when a secondary "type" card is clicked. Mirrors
// DashboardListPanel's mount / Escape / backdrop behaviour and reuses its
// `.hmp*` styling. Purely presentational — it lists whatever items the active
// card's hook produced (already filtered to not-done + today/overdue).
export default function SecondaryCardPanel({ card }: { card: SecondaryCardConfig | null }) {
  const setActiveSecondaryCard = usePMStore((s) => s.setActiveSecondaryCard);
  const [mounted, setMounted] = useState(false);
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

  if (!card) return null;

  const items = card.data.items;
  const isLoading = card.data.isLoading;
  const overdueCount = items.filter((i) => i.overdue).length;
  const close = () => setActiveSecondaryCard(null);

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
            <div className="hmp-eyebrow">Due today or overdue</div>
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
                <div className="p">Items appear when they're due today or overdue.</div>
              </div>
            </div>
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
        <div className="meta">
          <span className="when" data-overdue={item.overdue || undefined}>{item.whenText}</span>
        </div>
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
