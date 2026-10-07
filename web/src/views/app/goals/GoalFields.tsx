import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { GoalPriority, GoalStoredStatus } from '@squadhub/shared';
import type { TaskPriority } from '@squadhub/shared';
import DatePicker from '../pm/DatePicker';
import PriorityPicker from '../pm/PriorityPicker';
import GoalIcon, { Avatar, AvatarStack, type MemberLike } from './GoalIcons';
import { PRIORITY_META, STATUS_META, STORED_STATUSES, formatDay, formatRange } from './goalUtils';

/** Anchored floating panel, portaled above the goal overlay. */
export function Popover({ anchor, onClose, children, width = 260, className = '' }: {
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchor.bottom + 6, left: anchor.left });
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight || 0;
    let left = Math.min(anchor.left, window.innerWidth - width - 10);
    left = Math.max(10, left);
    let top = anchor.bottom + 6;
    if (top + h > window.innerHeight - 10) top = Math.max(10, anchor.top - h - 6);
    setPos({ top, left });
  }, [anchor, width]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className={`gl-pop ${className}`} style={{ top: pos.top, left: pos.left, width }}>
      {children}
    </div>,
    document.body,
  );
}

export function useAnchor() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return {
    anchor,
    open: (e: React.MouseEvent) => setAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()),
    close: () => setAnchor(null),
  };
}

export function StatusPill({ status }: { status: keyof typeof STATUS_META }) {
  const m = STATUS_META[status];
  return (
    <span className="gl-status" style={{ '--st': m.color } as React.CSSProperties}>
      <i />{m.label}
    </span>
  );
}

export function StatusSelect({ value, achieved, onChange, disabled }: {
  value: GoalStoredStatus;
  achieved?: boolean;
  onChange: (s: GoalStoredStatus) => void;
  disabled?: boolean;
}) {
  const a = useAnchor();
  return (
    <>
      <button type="button" className="gl-field-btn" onClick={a.open} disabled={disabled}>
        <StatusPill status={achieved ? 'achieved' : value} />
        <GoalIcon name="chevronDown" size={13} className="gl-field-caret" />
      </button>
      {a.anchor && (
        <Popover anchor={a.anchor} onClose={a.close} width={220}>
          {achieved && <div className="gl-pop-note">Every task is done, so this goal shows as achieved. Its saved status returns if work reopens.</div>}
          {STORED_STATUSES.map((s) => (
            <button key={s} type="button" className="gl-pop-item" data-active={s === value || undefined}
              onClick={() => { onChange(s); a.close(); }}>
              <StatusPill status={s} />
              {s === value && <GoalIcon name="check" size={14} className="gl-pop-check" />}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

export function PriorityBadge({ priority, showNone = false }: { priority: GoalPriority; showNone?: boolean }) {
  if (priority === 'none' && !showNone) return null;
  const m = PRIORITY_META[priority];
  return (
    <span className="gl-priority" style={{ '--pr': m.color } as React.CSSProperties} data-p={priority}>
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 0h11l-2 4 2 4H5" fill={priority === 'none' ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
      {m.label}
    </span>
  );
}

export function PrioritySelect({ value, onChange, title }: { value: GoalPriority; onChange: (p: GoalPriority) => void; title?: string }) {
  const a = useAnchor();
  return (
    <>
      <button type="button" className="gl-field-btn" onClick={a.open}>
        <PriorityBadge priority={value} showNone />
        <GoalIcon name="chevronDown" size={13} className="gl-field-caret" />
      </button>
      {a.anchor && (
        <PriorityPicker anchorRect={a.anchor} value={value as TaskPriority} taskTitle={title}
          onChange={(p) => onChange(p as GoalPriority)} onClose={a.close} />
      )}
    </>
  );
}

export function MemberSelect({ members, value, onChange, placeholder = 'Assign people' }: {
  members: MemberLike[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}) {
  const a = useAnchor();
  const [q, setQ] = useState('');
  const selected = value.map((id) => members.find((m) => m.id === id)).filter(Boolean) as MemberLike[];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...members]
      .filter((m) => !needle || m.display_name.toLowerCase().includes(needle))
      .sort((x, y) => Number(value.includes(y.id)) - Number(value.includes(x.id)) || x.display_name.localeCompare(y.display_name));
  }, [members, q, value]);
  return (
    <>
      <button type="button" className="gl-field-btn" onClick={(e) => { setQ(''); a.open(e); }}>
        {selected.length ? (
          <>
            <AvatarStack members={selected} size={22} max={4} />
            <span className="gl-field-text">{selected.length === 1 ? selected[0].display_name : `${selected.length} people`}</span>
          </>
        ) : (
          <span className="gl-field-placeholder"><GoalIcon name="people" size={15} />{placeholder}</span>
        )}
      </button>
      {a.anchor && (
        <Popover anchor={a.anchor} onClose={a.close} width={280}>
          <label className="gl-pop-search">
            <GoalIcon name="search" size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" />
          </label>
          <div className="gl-pop-scroll">
            {filtered.map((m) => {
              const on = value.includes(m.id);
              return (
                <button key={m.id} type="button" className="gl-pop-item" data-active={on || undefined}
                  onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}>
                  <Avatar member={m} size={24} />
                  <span className="gl-pop-label">{m.display_name}</span>
                  <span className="gl-checkbox" data-on={on || undefined}>{on && <GoalIcon name="check" size={11} strokeWidth={2.6} />}</span>
                </button>
              );
            })}
            {!filtered.length && <div className="gl-pop-empty">No one matches “{q}”</div>}
          </div>
        </Popover>
      )}
    </>
  );
}

export function LabelInput({ value, onChange, suggestions = [] }: { value: string[]; onChange: (labels: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const add = (raw: string) => {
    const label = raw.trim().replace(/,$/, '').trim();
    if (!label || value.some((v) => v.toLowerCase() === label.toLowerCase()) || value.length >= 20) return;
    onChange([...value, label.slice(0, 60)]);
  };
  const open = suggestions.filter((s) => !value.includes(s) && s.toLowerCase().includes(text.trim().toLowerCase())).slice(0, 6);
  return (
    <div className="gl-labels-input" data-focus={focus || undefined}>
      {value.map((l) => (
        <span key={l} className="gl-label">
          {l}
          <button type="button" aria-label={`Remove ${l}`} onClick={() => onChange(value.filter((v) => v !== l))}>
            <GoalIcon name="close" size={10} strokeWidth={2.4} />
          </button>
        </span>
      ))}
      <input
        value={text}
        placeholder={value.length ? '' : 'Add labels…'}
        onFocus={() => setFocus(true)}
        onBlur={() => { setTimeout(() => setFocus(false), 120); if (text.trim()) { add(text); setText(''); } }}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(',')) { add(v); setText(''); } else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(text); setText(''); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
      />
      {focus && open.length > 0 && (
        <div className="gl-label-suggest">
          {open.map((s) => (
            <button key={s} type="button" onMouseDown={(e) => { e.preventDefault(); add(s); setText(''); }}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Two date buttons (start → end) backed by the app's DatePicker. */
export function DateRangeField({ kind, start, end, onChange, startLabel, endLabel, disabled }: {
  kind: 'work' | 'plan';
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  startLabel: string;
  endLabel: string;
  disabled?: boolean;
}) {
  const [picker, setPicker] = useState<{ which: 'start' | 'end'; rect: DOMRect } | null>(null);
  const pick = (which: 'start' | 'end') => (e: React.MouseEvent) => {
    e.stopPropagation();
    setPicker({ which, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
  };
  return (
    <div className="gl-daterange" data-kind={kind}>
      <span className="gl-daterange-key" aria-hidden="true" />
      <button type="button" className="gl-date-btn" onClick={pick('start')} disabled={disabled} data-empty={!start || undefined}>
        <small>{startLabel}</small>
        {start ? formatDay(start) : 'Set date'}
      </button>
      <GoalIcon name="arrow" size={13} className="gl-daterange-arrow" />
      <button type="button" className="gl-date-btn" onClick={pick('end')} disabled={disabled} data-empty={!end || undefined}>
        <small>{endLabel}</small>
        {end ? formatDay(end) : 'Set date'}
      </button>
      {(start || end) && !disabled && (
        <button type="button" className="gl-icon-btn gl-daterange-clear" aria-label={`Clear ${kind === 'work' ? 'work dates' : 'start and due dates'}`}
          onClick={() => onChange(null, null)}>
          <GoalIcon name="close" size={12} />
        </button>
      )}
      {picker && typeof document !== 'undefined' && createPortal(
        <DatePicker
          anchorRect={picker.rect}
          mode="date"
          value={picker.which === 'start' ? start : end}
          onClose={() => setPicker(null)}
          onChange={(next) => {
            const day = next ? next.slice(0, 10) : null;
            if (picker.which === 'start') onChange(day, end && day && end < day ? day : end);
            else onChange(start && day && day < start ? day : start, day);
            setPicker(null);
          }}
        />,
        document.body,
      )}
    </div>
  );
}

export function rangeSummary(start: string | null, end: string | null) {
  return formatRange(start, end) || 'Not set';
}
