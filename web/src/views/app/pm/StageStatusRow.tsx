import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskStatusDef, TaskStatusKey } from '@squadhub/shared';
import { getTaskStatusDef } from '@squadhub/shared';
import { useAuthStore } from '../../../stores/authStore';
import { stagesFromDefs } from '../../../lib/stages';
import './stage-row.css';

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL
  || (process.env.NODE_ENV === 'production' ? 'https://admin.squadhub.in' : 'http://localhost:3001');

const mix = (c: string, p: number) => `color-mix(in oklch, ${c} ${p}%, transparent)`;

/**
 * The full-width first row of the task panels: STAGE (the main thing, a tinted
 * button that opens the stage list) then the few STATUSES inside that stage as
 * a segmented control. Picking a stage moves the task to its first status.
 */
export default function StageStatusRow({
  defs,
  value,
  originalStatus,
  onChange,
  canEdit = true,
  groupName,
  icon,
}: {
  defs: TaskStatusDef[];
  value: string | null | undefined;
  /** Original status remembered while parked in a placeholder (Unblocked). */
  originalStatus?: string | null;
  onChange: (key: TaskStatusKey) => void;
  canEdit?: boolean;
  /** Name of the list's stage group, shown in the picker footer. */
  groupName?: string | null;
  icon?: React.ReactNode;
}) {
  const isAdmin = !!(useAuthStore((s) => s.user) as { is_admin?: boolean } | null)?.is_admin;
  const stages = useMemo(() => stagesFromDefs(defs), [defs]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const currentDef = defs.find((d) => d.key === value) || getTaskStatusDef(value) || null;
  // A placeholder (Unblocked) shows the stage the task came from.
  const parkedOrig = currentDef?.is_placeholder && originalStatus
    ? defs.find((d) => d.key === originalStatus) || null
    : null;
  const shownDef = parkedOrig || currentDef;
  const stage = stages.find((s) => s.key === shownDef?.group)
    || stages.find((s) => s.statuses.some((d) => d.key === value))
    || null;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHighlightedIndex(-1);
      return;
    }
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = (e: Event) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      if (btnRef.current) setAnchor(btnRef.current.getBoundingClientRect());
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    if (btnRef.current) setAnchor(btnRef.current.getBoundingClientRect());
    setOpen((v) => !v);
  };

  const pickStage = (key: string) => {
    setOpen(false);
    const st = stages.find((s) => s.key === key);
    if (!st) return;
    const isAlreadyInStage = st.statuses.some((d) => d.key === value);
    if (isAlreadyInStage) return;
    const first = st.statuses[0];
    if (first) onChange(first.key);
  };

  const pickStatus = (key: TaskStatusKey) => {
    setOpen(false);
    if (key !== value || currentDef?.is_placeholder) {
      onChange(key);
    }
  };

  const q = query.trim().toLowerCase();
  const filteredStages = useMemo(() => {
    if (!q) {
      return stages
        .filter((s) => s.statuses.length > 0)
        .map((s) => ({
          stage: s,
          statuses: s.statuses,
          isStageMatch: false,
        }));
    }
    const results: Array<{
      stage: typeof stages[number];
      statuses: typeof stages[number]['statuses'];
      isStageMatch: boolean;
    }> = [];

    for (const s of stages) {
      if (s.statuses.length === 0) continue;
      const stageMatch = s.label.toLowerCase().includes(q);
      const matchingStatuses = s.statuses.filter((d) => {
        const labelMatch = d.label.toLowerCase().includes(q);
        const descMatch = d.description ? d.description.toLowerCase().includes(q) : false;
        return labelMatch || descMatch;
      });

      if (stageMatch) {
        results.push({
          stage: s,
          statuses: s.statuses,
          isStageMatch: true,
        });
      } else if (matchingStatuses.length > 0) {
        results.push({
          stage: s,
          statuses: matchingStatuses,
          isStageMatch: false,
        });
      }
    }
    return results;
  }, [stages, q]);

  type NavItem =
    | { type: 'stage'; id: string; stageKey: string }
    | { type: 'status'; id: string; statusKey: TaskStatusKey; stageKey: string };

  const navItems = useMemo<NavItem[]>(() => {
    const list: NavItem[] = [];
    for (const { stage: s, statuses: stList, isStageMatch } of filteredStages) {
      if (!q || isStageMatch) {
        list.push({ type: 'stage', id: `stage-${s.key}`, stageKey: s.key });
      }
      for (const d of stList) {
        list.push({ type: 'status', id: `status-${d.key}`, statusKey: d.key, stageKey: s.key });
      }
    }
    return list;
  }, [filteredStages, q]);

  useEffect(() => {
    setHighlightedIndex(query.trim() && navItems.length > 0 ? 0 : -1);
  }, [query, navItems.length]);

  useEffect(() => {
    if (highlightedIndex < 0 || !navItems[highlightedIndex]) return;
    const id = navItems[highlightedIndex].id;
    const el = popRef.current?.querySelector(`[data-nav-id="${id}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, navItems]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        if (navItems.length === 0) return -1;
        return prev + 1 < navItems.length ? prev + 1 : 0;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        if (navItems.length === 0) return -1;
        return prev - 1 >= 0 ? prev - 1 : navItems.length - 1;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = highlightedIndex >= 0 ? navItems[highlightedIndex] : (q && navItems[0] ? navItems[0] : null);
      if (target) {
        if (target.type === 'stage') {
          pickStage(target.stageKey);
        } else {
          pickStatus(target.statusKey);
        }
      }
    }
  };

  const color = stage?.color || currentDef?.color || '#A0A0A0';
  const popStyle: React.CSSProperties = (() => {
    if (!anchor || typeof window === 'undefined') return { visibility: 'hidden' };
    const width = Math.min(340, window.innerWidth - 16);
    const maxH = Math.min(480, window.innerHeight - 24);
    const below = window.innerHeight - anchor.bottom;
    const up = below < 340 && anchor.top > below;
    let left = anchor.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    return {
      position: 'fixed',
      top: up ? Math.max(8, anchor.top - 6 - maxH) : anchor.bottom + 6,
      left: Math.max(8, left),
      width,
      maxHeight: maxH,
    };
  })();

  return (
    <div className="stg-row" data-td="stage" onClick={(e) => e.stopPropagation()}>
      <span className="stg-k">{icon}Stage</span>
      <div className="stg-v">
        <button
          ref={btnRef}
          type="button"
          className="stg-stage"
          style={{ background: mix(color, 14) }}
          onClick={toggle}
          disabled={!canEdit}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="stg-stage-dot" style={{ background: color, boxShadow: `0 0 0 3px ${mix(color, 22)}` }} />
          {stage?.label || currentDef?.groupLabel || 'No stage'}
          {canEdit && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
          )}
        </button>
        {stage && stage.statuses.length > 0 && (
          <div className="stg-seg" role="radiogroup" aria-label={`${stage.label} statuses`}>
            {stage.statuses.map((d) => {
              const on = d.key === (shownDef?.key || value);
              return (
                <button
                  key={d.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="stg-status"
                  data-on={on || undefined}
                  title={d.description || undefined}
                  disabled={!canEdit}
                  onClick={(e) => { e.stopPropagation(); if (!on || currentDef?.is_placeholder) onChange(d.key); }}
                >
                  {on && <span className="stg-status-dot" style={{ background: color }} />}
                  {d.label}
                </button>
              );
            })}
          </div>
        )}
        {currentDef?.is_placeholder && (
          <span className="stg-parked" title={currentDef.description || undefined}>
            <span className="stg-status-dot" style={{ background: currentDef.color }} />
            {currentDef.label}
          </span>
        )}
        {!stage && currentDef && (
          <span className="stg-parked">{currentDef.label}</span>
        )}
      </div>
      {open && createPortal(
        <div
          ref={popRef}
          className="stg-pop"
          style={popStyle}
          role="dialog"
          aria-label="Select stage or status"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          <div className="stg-pop-search">
            <svg
              className="stg-pop-search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stages or statuses..."
              aria-label="Search stages or statuses"
              className="stg-pop-search-input"
            />
            {query && (
              <button
                type="button"
                className="stg-pop-clear"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className="stg-pop-list" role="listbox">
            {filteredStages.length === 0 ? (
              <div className="stg-pop-empty">
                <div className="stg-pop-empty-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <div className="stg-pop-empty-title">No stages or statuses match &ldquo;{query}&rdquo;</div>
                <div className="stg-pop-empty-sub">Try searching with a different term</div>
              </div>
            ) : (
              filteredStages.map(({ stage: s, statuses: stList }) => {
                const curStage = s.key === stage?.key;
                const stageNavId = `stage-${s.key}`;
                const isStageHighlighted = highlightedIndex >= 0 && navItems[highlightedIndex]?.id === stageNavId;

                return (
                  <div key={s.key} className="stg-pop-stage-group">
                    <button
                      type="button"
                      role="option"
                      aria-selected={curStage}
                      className="stg-pop-stage-row"
                      data-nav-id={stageNavId}
                      data-highlighted={isStageHighlighted || undefined}
                      onClick={() => pickStage(s.key)}
                      title={`Set stage to ${s.label}`}
                    >
                      <span className="stg-pop-dot" style={{ background: s.color }} />
                      <span className="stg-pop-stage-name">{s.label}</span>
                      {curStage && (
                        <svg className="stg-pop-stage-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="m5 12 5 5 9-10" />
                        </svg>
                      )}
                    </button>
                    <div className="stg-pop-chips">
                      {stList.map((d) => {
                        const isStatusActive = d.key === (shownDef?.key || value);
                        const statusNavId = `status-${d.key}`;
                        const isStatusHighlighted = highlightedIndex >= 0 && navItems[highlightedIndex]?.id === statusNavId;

                        return (
                          <button
                            key={d.key}
                            type="button"
                            role="option"
                            aria-selected={isStatusActive}
                            className="stg-pop-chip"
                            data-nav-id={statusNavId}
                            data-active={isStatusActive || undefined}
                            data-highlighted={isStatusHighlighted || undefined}
                            style={{ '--chip-color': d.color || s.color } as React.CSSProperties}
                            onClick={(e) => {
                              e.stopPropagation();
                              pickStatus(d.key);
                            }}
                            title={d.description || `Set status to ${d.label}`}
                          >
                            <span className="stg-pop-chip-dot" style={{ background: d.color || s.color }} />
                            <span className="stg-pop-chip-name">{d.label}</span>
                            {isStatusActive && (
                              <svg className="stg-pop-chip-check" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="m5 12 5 5 9-10" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="stg-pop-foot">
            <span>Stage group</span>
            <span className="stg-pop-group">{groupName || 'Workspace default'}</span>
            {isAdmin && (
              <a className="stg-pop-manage" href={`${ADMIN_URL}/admin/status-groups`} target="_blank" rel="noreferrer">Manage</a>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
