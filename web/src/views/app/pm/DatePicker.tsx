import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

type Mode = 'date' | 'datetime';
type Meridiem = 'AM' | 'PM';
type OpenPart = 'hour' | 'minute' | null;

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTE_STEP = 5;
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function parseValue(value: string | null, mode: Mode): Date | null {
  if (!value) return null;
  if (mode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function serializeDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const start = new Date(firstOfMonth);
  start.setDate(1 - firstOfMonth.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function to24(hour12: number, meridiem: Meridiem): number {
  if (meridiem === 'AM') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function composeDateTime(date: Date, hour12: number, minute: number, meridiem: Meridiem): Date {
  const d = new Date(date);
  d.setHours(to24(hour12, meridiem), minute, 0, 0);
  return d;
}

export default function DatePicker({
  anchorRect,
  value,
  mode,
  onChange,
  onClose,
}: {
  anchorRect: DOMRect | null;
  value: string | null;
  mode: Mode;
  onChange: (next: string | null) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }, []);

  const initial = useMemo(() => parseValue(value, mode), [value, mode]);
  const initialHasTime = mode === 'datetime'
    && initial != null
    && !(initial.getHours() === 0 && initial.getMinutes() === 0);

  const [viewYear, setViewYear] = useState(() => (initial ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (initial ?? today).getMonth());
  const [selected, setSelected] = useState<Date | null>(initial);

  const [hour12, setHour12] = useState<number>(() => {
    if (!initial) return 9;
    const h = initial.getHours();
    if (h === 0) return 12;
    if (h > 12) return h - 12;
    return h;
  });
  const [minute, setMinute] = useState<number>(() => {
    if (!initial) return 0;
    return Math.min(55, Math.round(initial.getMinutes() / MINUTE_STEP) * MINUTE_STEP);
  });
  const [meridiem, setMeridiem] = useState<Meridiem>(() => {
    if (!initial) return 'AM';
    return initial.getHours() >= 12 ? 'PM' : 'AM';
  });
  const [timeSet, setTimeSet] = useState<boolean>(initialHasTime);
  const [openPart, setOpenPart] = useState<OpenPart>(null);
  const hourMenuRef = useRef<HTMLDivElement>(null);
  const minuteMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (openPart) setOpenPart(null);
        else onClose();
      }
    }
    function onClickOutside(e: MouseEvent) {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose, openPart]);

  // Auto-scroll the currently-selected item into the open menu's view.
  useLayoutEffect(() => {
    const ref = openPart === 'hour' ? hourMenuRef : openPart === 'minute' ? minuteMenuRef : null;
    if (!ref?.current) return;
    const active = ref.current.querySelector<HTMLElement>('[data-active="true"]');
    if (active) active.scrollIntoView({ block: 'center' });
  }, [openPart]);

  const style = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { top: 0, left: 0 };
    const width = 288;
    const estHeight = mode === 'datetime' ? 408 : 332;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    const placeAbove = spaceBelow < estHeight && spaceAbove > spaceBelow;
    // Center the popover under the anchor so narrow cells don't get a picker
    // that spills awkwardly to one side.
    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    let left = anchorCenter - width / 2;
    if (left + width > vw - 8) left = vw - width - 8;
    if (left < 8) left = 8;
    const top = placeAbove
      ? Math.max(8, anchorRect.top - estHeight - 6)
      : anchorRect.bottom + 6;
    return { top, left, width };
  }, [anchorRect, mode]);

  const grid = useMemo(() => buildGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  function goPrev() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }
  function goNext() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function commitDate(date: Date, withTime: boolean, h = hour12, m = minute, mer = meridiem) {
    if (mode === 'date') {
      onChange(serializeDate(date));
      return;
    }
    if (withTime) {
      onChange(composeDateTime(date, h, m, mer).toISOString());
    } else {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      onChange(d.toISOString());
    }
  }

  function pickDay(d: Date) {
    setSelected(d);
    commitDate(d, mode === 'datetime' && timeSet);
    if (mode === 'date') onClose();
  }

  function applyPreset(offsetDays: number) {
    const d = new Date(today);
    d.setDate(today.getDate() + offsetDays);
    setSelected(d);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    commitDate(d, mode === 'datetime' && timeSet);
    if (mode === 'date') onClose();
  }

  function clear() {
    setSelected(null);
    setTimeSet(false);
    onChange(null);
    onClose();
  }

  function changeHour(h: number) {
    setHour12(h);
    setTimeSet(true);
    if (selected) commitDate(selected, true, h, minute, meridiem);
  }
  function changeMinute(m: number) {
    setMinute(m);
    setTimeSet(true);
    if (selected) commitDate(selected, true, hour12, m, meridiem);
  }
  function changeMeridiem(mer: Meridiem) {
    setMeridiem(mer);
    setTimeSet(true);
    if (selected) commitDate(selected, true, hour12, minute, mer);
  }
  function clearTime() {
    setTimeSet(false);
    if (selected) commitDate(selected, false);
  }
  function addTime() {
    // Default to 9:00 AM when explicitly adding a time.
    setHour12(9);
    setMinute(0);
    setMeridiem('AM');
    setTimeSet(true);
    if (selected) commitDate(selected, true, 9, 0, 'AM');
  }

  const monthLabel = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  return (
    <div
      ref={panelRef}
      className="dp-panel"
      style={style}
      role="dialog"
      aria-label="Pick a date"
      onClick={(e) => {
        if (!openPart) return;
        const t = e.target as HTMLElement;
        if (t.closest('.dp-time-menu') || t.closest('.dp-time-trigger')) return;
        setOpenPart(null);
      }}
    >
      <div className="dp-header">
        <button
          type="button"
          className="dp-nav"
          onClick={goPrev}
          aria-label="Previous month"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="dp-title">{monthLabel}</div>
        <button
          type="button"
          className="dp-nav"
          onClick={goNext}
          aria-label="Next month"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="dp-weekdays">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="dp-wd">{w}</span>
        ))}
      </div>

      <div className="dp-grid">
        {grid.map((d) => {
          const inMonth = d.getMonth() === viewMonth;
          const isToday = sameDay(d, today);
          const isSelected = selected != null && sameDay(d, selected);
          return (
            <button
              type="button"
              key={d.toISOString()}
              className="dp-day"
              data-in-month={inMonth}
              data-today={isToday}
              data-selected={isSelected}
              onClick={() => pickDay(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="dp-presets">
        <button type="button" className="dp-chip" onClick={() => applyPreset(0)}>Today</button>
        <button type="button" className="dp-chip" onClick={() => applyPreset(1)}>Tomorrow</button>
        <button type="button" className="dp-chip" onClick={() => applyPreset(7)}>Next week</button>
      </div>

      {mode === 'datetime' && !timeSet && (
        <div className="dp-time">
          <button
            type="button"
            className="dp-add-time"
            onClick={addTime}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            Add time
          </button>
        </div>
      )}

      {mode === 'datetime' && timeSet && (
        <div className="dp-time">
          <span className="dp-time-label">Time</span>
          <div className="dp-time-wrap" data-set={timeSet}>
            <div className="dp-time-field">
              <button
                type="button"
                className="dp-time-trigger"
                data-open={openPart === 'hour'}
                onClick={() => setOpenPart(openPart === 'hour' ? null : 'hour')}
                aria-label="Hour"
                aria-haspopup="listbox"
                aria-expanded={openPart === 'hour'}
              >
                {pad(hour12)}
              </button>
              {openPart === 'hour' && (
                <div ref={hourMenuRef} className="dp-time-menu" role="listbox" aria-label="Hour">
                  {HOURS_12.map(h => (
                    <button
                      key={h}
                      type="button"
                      role="option"
                      data-active={h === hour12}
                      aria-selected={h === hour12}
                      onClick={() => { changeHour(h); setOpenPart(null); }}
                    >
                      {pad(h)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="dp-time-sep">:</span>
            <div className="dp-time-field">
              <button
                type="button"
                className="dp-time-trigger"
                data-open={openPart === 'minute'}
                onClick={() => setOpenPart(openPart === 'minute' ? null : 'minute')}
                aria-label="Minute"
                aria-haspopup="listbox"
                aria-expanded={openPart === 'minute'}
              >
                {pad(minute)}
              </button>
              {openPart === 'minute' && (
                <div ref={minuteMenuRef} className="dp-time-menu" role="listbox" aria-label="Minute">
                  {MINUTES.map(m => (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      data-active={m === minute}
                      aria-selected={m === minute}
                      onClick={() => { changeMinute(m); setOpenPart(null); }}
                    >
                      {pad(m)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="dp-ampm">
              <button
                type="button"
                data-active={meridiem === 'AM'}
                onClick={() => changeMeridiem('AM')}
                aria-pressed={meridiem === 'AM'}
              >
                AM
              </button>
              <button
                type="button"
                data-active={meridiem === 'PM'}
                onClick={() => changeMeridiem('PM')}
                aria-pressed={meridiem === 'PM'}
              >
                PM
              </button>
            </div>
          </div>
          <button
            type="button"
            className="dp-time-clear"
            onClick={clearTime}
            aria-label="Clear time"
            title="Clear time"
          >
            ×
          </button>
        </div>
      )}

      <div className="dp-footer">
        <button
          type="button"
          className="dp-clear"
          onClick={clear}
          disabled={!selected}
        >
          Clear
        </button>
        {mode === 'datetime' && (
          <button type="button" className="dp-done" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}
