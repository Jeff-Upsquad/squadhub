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
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

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
    if (!st || st.key === stage?.key) return;
    const first = st.statuses[0];
    if (first) onChange(first.key);
  };

  const color = stage?.color || currentDef?.color || '#A0A0A0';
  const popStyle: React.CSSProperties = (() => {
    if (!anchor || typeof window === 'undefined') return { visibility: 'hidden' };
    const width = 330;
    const maxH = Math.min(440, window.innerHeight - 24);
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
        <div ref={popRef} className="stg-pop" style={popStyle} role="listbox" onMouseDown={(e) => e.stopPropagation()}>
          <div className="stg-pop-list">
            {stages.filter((s) => s.statuses.length > 0).map((s) => {
              const cur = s.key === stage?.key;
              return (
                <button key={s.key} type="button" role="option" aria-selected={cur} className="stg-pop-item" onClick={() => pickStage(s.key)}>
                  <span className="stg-pop-dot" style={{ background: s.color }} />
                  <span className="stg-pop-text">
                    <span className="stg-pop-name">{s.label}</span>
                    <span className="stg-pop-line">{s.statuses.map((d) => d.label).join(' · ')}</span>
                  </span>
                  {cur && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12 5 5 9-10" /></svg>
                  )}
                </button>
              );
            })}
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
