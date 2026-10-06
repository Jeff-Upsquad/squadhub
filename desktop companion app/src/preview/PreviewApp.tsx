import { useMemo, useState } from 'react';
import '../styles.css';
import './preview.css';

type MenuKey = 'type' | 'status' | 'priority' | 'assignee' | 'workdate' | 'rangedate' | 'labels' | 'location' | null;

const TYPES = [
  { id: 't-task', key: 'task', name: 'Task', color: '#9ca3af', group: 'Task Types', desc: 'Requires more than 10 minutes to complete.', is_default: true },
  { id: 't-todo', key: 'todo', name: 'Todo', color: '#6b7280', group: 'Task Types', desc: 'Quick tasks that take only a couple of minutes.' },
  { id: 't-workblock', key: 'work_block', name: 'Work Block', color: '#60a5fa', group: 'Task Types', desc: 'Similar tasks grouped together in a time block.' },
  { id: 't-focus', key: 'focus_task', name: 'Focus Task', color: '#8b5cf6', group: 'Task Types', desc: 'Tasks requiring uninterrupted focus and deep work.' },
  { id: 't-routine', key: 'routine', name: 'Routine', color: '#a855f7', group: 'Task Types', desc: 'Recurring tasks done at regular intervals.' },
  { id: 't-coding', key: 'coding', name: 'Coding', color: '#22c55e', group: 'Software Development', desc: 'Feature implementation and bug fixing.' },
  { id: 't-testing', key: 'testing', name: 'Testing', color: '#14b8a6', group: 'Software Development', desc: 'QA verification and bug validation.' },
  { id: 't-meeting', key: 'meeting', name: 'Meeting', color: '#a855f7', group: 'Meetings & Collaboration', desc: 'Scheduled meetings and collaborative sessions.' },
  { id: 't-call', key: 'call', name: 'Call', color: '#38bdf8', group: 'Meetings & Collaboration', desc: 'Phone or audio-only communication.' },
  { id: 't-learning', key: 'learning', name: 'Learning', color: '#f59e0b', group: 'Learning & Exploration', desc: 'Acquiring knowledge by reading, watching, or listening.' },
  { id: 't-design', key: 'design_task', name: 'Design', color: '#ec4899', group: 'Media Creation', desc: 'Visual design deliverables.' },
  { id: 't-followup', key: 'follow_ups', name: 'Follow-up', color: '#78716c', group: 'Follow-ups & Monitoring', desc: 'Checking back on pending actions.' },
];

const TYPE_GROUP_ORDER = [
  'Task Types',
  'Software Development',
  'Meetings & Collaboration',
  'Learning & Exploration',
  'Media Creation',
  'Follow-ups & Monitoring',
];

const TASK_CATALOG = [
  { name: 'Open', color: '#9ca3af' },
  { name: 'Today', color: '#f97316' },
  { name: 'In Progress', color: '#16a34a' },
  { name: 'On Hold', color: '#78716c' },
  { name: 'Closed', color: '#10b981' },
];

const SPACE_STATUSES = [
  { name: 'Todo', color: '#9ca3af' },
  { name: 'In Progress', color: '#3b82f6' },
  { name: 'Review', color: '#f59e0b' },
  { name: 'Done', color: '#10b981' },
];

const PRIORITIES = [
  { value: 'emergency', label: 'Emergency', color: '#dc2626' },
  { value: 'urgent', label: 'Urgent', color: '#f97316' },
  { value: 'high', label: 'High', color: '#eab308' },
  { value: 'normal', label: 'Normal', color: '#3b82f6' },
  { value: 'low', label: 'Low', color: '#9ca3af' },
  { value: 'none', label: 'No priority', color: '#6b7280' },
];

const PEOPLE = ['Alex Carter', 'Priya Nair', 'Sam Lee'];
const ME = 'You';

const ALL_LOCATIONS = [
  { id: 'my', name: 'My Tasks', star: true, path: 'Personal' },
  { id: 'web', name: 'Website', path: 'Acme / Sprint 12' },
  { id: 'design', name: 'Design', path: 'Acme' },
  { id: 'mobile', name: 'Mobile App', path: 'Acme / Sprint 12' },
  { id: 'marketing', name: 'Marketing', path: 'Growth' },
  { id: 'backend', name: 'Backend', path: 'Acme / Platform' },
  { id: 'q4', name: 'Q4 Planning', path: 'Ops' },
  { id: 'client', name: 'Client Work', path: 'Ops / Retainers' },
  { id: 'support', name: 'Support Inbox', path: 'Ops' },
  { id: 'research', name: 'Research', path: 'Growth / Discovery' },
];

function fmt(s: string | null) {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const delta = Math.round((that.getTime() - today.getTime()) / 86400000);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toYmd(d);
}
/** Upcoming Saturday (today if Saturday). */
function weekendYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return toYmd(d);
}
/** Next Monday (7 days out if today is Monday). */
function nextWeekYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return toYmd(d);
}
function shortDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

function MiniCalendar({ value, onPick }: { value: string | null; onPick: (ymd: string) => void }) {
  const seed = value ? new Date(`${value}T00:00:00`) : new Date();
  const [view, setView] = useState({ y: seed.getFullYear(), m: seed.getMonth() });
  const todayYmd = toYmd(new Date());
  const first = new Date(view.y, view.m, 1);
  // Monday-first offset: Mon=0 … Sun=6
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const cellYmd = (day: number) => toYmd(new Date(view.y, view.m, day));

  return (
    <div className="pv-cal">
      <div className="pv-cal-head">
        <button type="button" className="pv-cal-nav" aria-label="Previous month"
          onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}>‹</button>
        <span className="pv-cal-title">{monthName}</span>
        <button type="button" className="pv-cal-nav" aria-label="Next month"
          onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}>›</button>
      </div>
      <div className="pv-cal-grid">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <span key={d} className="pv-cal-dow">{d}</span>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <span key={`e-${i}`} />
          ) : (
            <button
              key={day}
              type="button"
              className={`pv-cal-day${cellYmd(day) === value ? ' sel' : ''}${cellYmd(day) === todayYmd ? ' today' : ''}`}
              onClick={() => onPick(cellYmd(day))}
            >
              {day}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export default function PreviewApp() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [menu, setMenu] = useState<MenuKey>(null);
  const [typeId, setTypeId] = useState('t-task');
  const [status, setStatus] = useState('Open');
  const [priority, setPriority] = useState('none');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [workDate, setWorkDate] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [complete, setComplete] = useState(false);
  const [timer, setTimer] = useState(false);
  const [estimate, setEstimate] = useState('');
  const [logged, setLogged] = useState('');
  const [typeSearch, setTypeSearch] = useState('');
  const [typeHi, setTypeHi] = useState(0);
  const [locId, setLocId] = useState('my');
  const [recentIds, setRecentIds] = useState(['my', 'web', 'design', 'mobile', 'marketing', 'backend', 'q4']);
  const [locSearch, setLocSearch] = useState('');

  const typeGroups = useMemo(() => {
    const q = typeSearch.trim().toLowerCase();
    const filtered = TYPES.filter((t) =>
      !q ||
      t.name.toLowerCase().includes(q) ||
      t.desc.toLowerCase().includes(q) ||
      t.group.toLowerCase().includes(q) ||
      t.key.toLowerCase().includes(q),
    );
    const out: { group: string; items: typeof TYPES }[] = [];
    for (const g of TYPE_GROUP_ORDER) {
      const items = filtered.filter((t) => t.group === g);
      if (items.length) out.push({ group: g, items });
    }
    for (const t of filtered) {
      if (!TYPE_GROUP_ORDER.includes(t.group) && !out.some((g) => g.group === t.group)) {
        out.push({ group: t.group, items: filtered.filter((x) => x.group === t.group) });
      }
    }
    return out;
  }, [typeSearch]);
  const typeFlat = useMemo(() => typeGroups.flatMap((g) => g.items), [typeGroups]);

  const type = TYPES.find((t) => t.id === typeId)!;
  const statuses = useMemo(() => (type.key === 'task' ? TASK_CATALOG : SPACE_STATUSES), [type.key]);
  const prio = PRIORITIES.find((p) => p.value === priority)!;

  const toggle = (k: Exclude<MenuKey, null>) =>
    setMenu((m) => {
      if (m === k) return null;
      if (k === 'type') { setTypeSearch(''); setTypeHi(0); }
      if (k === 'location') { setLocSearch(''); }
      return k;
    });
  const pickType = (id: string) => {
    setTypeId(id);
    const t = TYPES.find((x) => x.id === id)!;
    setStatus(t.key === 'task' ? 'Open' : 'Todo');
    setMenu(null);
  };
  const onTypeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setTypeHi((i) => (typeFlat.length ? (i + 1) % typeFlat.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setTypeHi((i) => (typeFlat.length ? (i - 1 + typeFlat.length) % typeFlat.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (typeFlat[typeHi]) pickType(typeFlat[typeHi].id); }
    else if (e.key === 'Escape') { setMenu(null); }
  };
  const isMe = assignees.includes(ME);
  const toggleMe = () =>
    setAssignees((c) => (c.includes(ME) ? c.filter((x) => x !== ME) : [...c, ME]));

  return (
    <div className="pv-page">
      <div className="pv-banner">
        <div>
          <div className="pv-banner-title">QuickAdd redesign — interactive preview</div>
          <div className="pv-banner-sub">
            Mock data only. Nothing saves. Pick a type → notice the status list changes (Task = catalog, everything else = space statuses).
          </div>
        </div>
        <span className="pv-tag">preview.html</span>
      </div>

      <div className="qa-scroll pv-canvas">
        <div className="qa">
          <div className="qa-row">
            <span className="qa-icon">+</span>
            <input className="qa-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" />
          </div>

          <div className="qa-desc pv-flat pv-desc-top">
            <textarea className="qa-textarea" rows={2} placeholder="Add a description…" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="pv-sec-label">Where</div>
          <div className="qa-chips pv-flat pv-where">
            {recentIds.map((id) => {
              const l = ALL_LOCATIONS.find((x) => x.id === id)!;
              return (
                <button
                  key={id}
                  type="button"
                  className={`qa-chip${locId === id ? ' active' : ''}`}
                  onClick={() => setLocId(id)}
                  title={l.path ? `${l.name} · ${l.path}` : l.name}
                >
                  {l.star ? '★ ' : ''}{l.name}
                </button>
              );
            })}
            <button
              type="button"
              className={`qa-chip pv-locsearch${menu === 'location' ? ' active' : ''}`}
              onClick={() => toggle('location')}
              title="Search all locations"
              aria-label="Search locations"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </button>
          </div>

          {menu === 'location' && (
            <div className="qa-menu">
              <input
                className="qa-search"
                autoFocus
                placeholder="Search lists…"
                value={locSearch}
                onChange={(e) => setLocSearch(e.target.value)}
              />
              <div className="qa-menu-scroll">
                {ALL_LOCATIONS.filter((l) => {
                  const q = locSearch.trim().toLowerCase();
                  return !q || l.name.toLowerCase().includes(q) || l.path.toLowerCase().includes(q);
                }).map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className="qa-opt"
                    onClick={() => {
                      if (!recentIds.includes(l.id)) setRecentIds((r) => [...r, l.id]);
                      setLocId(l.id);
                      setMenu(null);
                    }}
                  >
                    <span className="qa-opt-main">{l.star ? '★ ' : ''}{l.name}</span>
                    <span className="qa-opt-sub">{l.path}</span>
                  </button>
                ))}
                {ALL_LOCATIONS.filter((l) => {
                  const q = locSearch.trim().toLowerCase();
                  return !q || l.name.toLowerCase().includes(q) || l.path.toLowerCase().includes(q);
                }).length === 0 && (
                  <div className="qa-menu-empty">No lists found</div>
                )}
              </div>
            </div>
          )}

          <div className="pv-sec-label">What</div>
          <div className="qa-attrs pv-flat">
            <span className="pv-assign-wrap">
              <button
                type="button"
                className={`pv-mecircle${isMe ? ' on' : ''}`}
                title={isMe ? 'Assigned to you — click to remove' : 'Assign to me'}
                aria-label={isMe ? 'Remove self assignment' : 'Assign to me'}
                onClick={toggleMe}
              >
                {isMe ? (
                  <span className="pv-mecircle-initials">Y</span>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </button>
              <button type="button" className={`qa-pill${assignees.length ? ' active' : ' muted'}`} onClick={() => toggle('assignee')}>
                <span className="qa-pill-label">{assignees.length ? assignees.join(', ') : 'Assignee'}</span>
                <span className="pv-caret">▾</span>
              </button>
            </span>
            <button type="button" className="qa-pill active" onClick={() => toggle('type')}>
              <span className="qa-dot" style={{ background: type.color }} />
              <span className="qa-pill-label">{type.name}</span>
              <span className="pv-caret">▾</span>
            </button>
            <button type="button" className="qa-pill active" onClick={() => toggle('status')}>
              <span className="qa-dot" style={{ background: statuses.find((s) => s.name === status)?.color }} />
              <span className="qa-pill-label">{status}</span>
              <span className="pv-caret">▾</span>
            </button>
            <button type="button" className={`qa-pill${priority !== 'none' ? ' active' : ' muted'}`} onClick={() => toggle('priority')}>
              <span className="qa-dot" style={{ background: prio.color }} />
              <span className="qa-pill-label">{prio.label}</span>
              <span className="pv-caret">▾</span>
            </button>
            <button type="button" className={`qa-pill${labels.length ? ' active' : ' muted'}`} onClick={() => toggle('labels')}>
              <span className="qa-pill-label">{labels.length ? labels.join(', ') : 'Labels'}</span>
              <span className="pv-caret">▾</span>
            </button>
          </div>

          {menu === 'type' && (
            <div className="qa-menu">
              <input
                className="qa-search"
                autoFocus
                placeholder="Search task types (e.g. Focus, Plan, Call)…"
                value={typeSearch}
                onChange={(e) => { setTypeSearch(e.target.value); setTypeHi(0); }}
                onKeyDown={onTypeKeyDown}
              />
              <div className="qa-menu-scroll pv-type-scroll">
                {typeGroups.length === 0 && (
                  <div className="qa-menu-empty">No task types found — try a different term</div>
                )}
                {typeGroups.map((g) => (
                  <div key={g.group}>
                    <div className="qa-grouphead pv-type-group">{g.group}<span className="pv-type-count">{g.items.length}</span></div>
                    {g.items.map((t) => {
                      const flatIdx = typeFlat.indexOf(t);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={`qa-opt-row pv-type-row${flatIdx === typeHi ? ' pv-hi' : ''}`}
                          onClick={() => pickType(t.id)}
                          onMouseEnter={() => setTypeHi(flatIdx)}
                        >
                          <span className="pv-type-badge" style={{ backgroundColor: `${t.color}22`, color: t.color }}>
                            <span className="qa-dot" style={{ background: t.color }} />
                          </span>
                          <span className="pv-type-main">
                            <span className="pv-type-name">
                              {t.name}
                              {t.is_default && <span className="pv-type-default">Default</span>}
                            </span>
                            <span className="pv-type-desc">{t.desc}</span>
                          </span>
                          {t.id === typeId && <span className="qa-check">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="pv-type-footer">
                <span>{typeFlat.length} task type{typeFlat.length !== 1 ? 's' : ''}</span>
                <span>↑↓ navigate · ↵ pick</span>
              </div>
            </div>
          )}
          {menu === 'status' && (
            <div className="qa-menu">
              <div className="pv-menu-hint">{type.key === 'task' ? 'Task workflow statuses' : `Space statuses · type = ${type.name}`}</div>
              <div className="qa-menu-scroll">
                {statuses.map((s) => (
                  <button key={s.name} type="button" className="qa-opt-row" onClick={() => { setStatus(s.name); setMenu(null); }}>
                    <span className="qa-dot" style={{ background: s.color }} />
                    <span className="qa-opt-main">{s.name}</span>
                    {s.name === status && <span className="qa-check">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {menu === 'priority' && (
            <div className="qa-menu">
              <div className="qa-menu-scroll">
                {PRIORITIES.map((p) => (
                  <button key={p.value} type="button" className="qa-opt-row" onClick={() => { setPriority(p.value); setMenu(null); }}>
                    <span className="qa-dot" style={{ background: p.color }} />
                    <span className="qa-opt-main">{p.label}</span>
                    {p.value === priority && <span className="qa-check">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {menu === 'assignee' && (
            <div className="qa-menu">
              <div className="qa-menu-scroll">
                {[ME, ...PEOPLE].map((p) => (
                  <button key={p} type="button" className="qa-opt-row"
                    onClick={() => setAssignees((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]))}>
                    <span className="qa-avatar">{p === ME ? 'Y' : p.split(' ').map((w) => w[0]).join('')}</span>
                    <span className="qa-opt-main">{p === ME ? 'You (assign to me)' : p}</span>
                    {assignees.includes(p) && <span className="qa-check">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {menu === 'labels' && (
            <div className="qa-menu">
              <div className="qa-menu-scroll">
                {['onboarding', 'urgent-fix', 'v2'].map((l) => (
                  <button key={l} type="button" className="qa-opt-row"
                    onClick={() => setLabels((c) => (c.includes(l) ? c.filter((x) => x !== l) : [...c, l]))}>
                    <span className="qa-dot" style={{ background: '#6366f1' }} />
                    <span className="qa-opt-main">{l}</span>
                    {labels.includes(l) && <span className="qa-check">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pv-sec-label">When</div>
          <div className="qa-attrs pv-flat">
            <button type="button" className={`qa-pill${workDate ? ' active' : ' muted'}`} onClick={() => toggle('workdate')}>
              <span className="qa-pill-label">{workDate ? `Work: ${fmt(workDate)}` : 'Work date'}</span>
              <span className="pv-caret">▾</span>
            </button>
            <button type="button" className={`qa-pill${startDate || dueDate ? ' active' : ' muted'}`} onClick={() => toggle('rangedate')}>
              <span className="qa-pill-label">▶ {fmt(startDate) ?? 'Start'} → {fmt(dueDate) ?? 'Due'}</span>
              <span className="pv-caret">▾</span>
            </button>
            <button type="button" className={`qa-pill${estimate ? ' active' : ' muted'}`}>
              <span className="qa-pill-label">Estimate{estimate ? ` ${estimate}` : ''}</span>
            </button>
            <button type="button" className={`qa-pill${logged ? ' active' : ' muted'}`}>
              <span className="qa-pill-label">Logged{logged ? ` ${logged}` : ''}</span>
            </button>
          </div>

          {menu === 'workdate' && (
            <div className="qa-menu">
              <div className="pv-quickchips">
                {[
                  { label: 'Today', ymd: shiftYmd(0) },
                  { label: 'Tomorrow', ymd: shiftYmd(1) },
                  { label: `This weekend`, ymd: weekendYmd() },
                  { label: 'Next week', ymd: nextWeekYmd() },
                ].map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className={`qa-chip pv-qchip${workDate === c.ymd ? ' active' : ''}`}
                    onClick={() => { setWorkDate(c.ymd); setMenu(null); }}
                  >
                    <span className="pv-qchip-label">{c.label}</span>
                    <span className="pv-qchip-sub">{shortDay(c.ymd)}</span>
                  </button>
                ))}
              </div>
              <MiniCalendar value={workDate} onPick={(ymd) => { setWorkDate(ymd); setMenu(null); }} />
              <div className="pv-type-footer">
                <span>{workDate ? fmt(workDate) : 'No date set'}</span>
                <button type="button" className="pv-linkbtn" onClick={() => { setWorkDate(null); setMenu(null); }}>
                  Clear
                </button>
              </div>
            </div>
          )}
          {menu === 'rangedate' && (
            <div className="qa-menu">
              <div className="pv-range">
                <label>Start<input type="date" className="qa-date-input" value={startDate || ''} onChange={(e) => setStartDate(e.target.value || null)} /></label>
                <label>Due<input type="date" className="qa-date-input" value={dueDate || ''} onChange={(e) => setDueDate(e.target.value || null)} /></label>
                <button type="button" className="qa-chip" onClick={() => { setStartDate(null); setDueDate(null); setMenu(null); }}>Clear</button>
              </div>
            </div>
          )}

          <div className="pv-sec-label">Details</div>
          <div className="qa-attrs pv-flat">
            <button type="button" className={`qa-pill qa-star${focused ? ' active' : ' muted'}`} onClick={() => setFocused((v) => !v)}>
              {focused ? '★ Focused' : '☆ Focus'}
            </button>
            <button type="button" className={`qa-pill${complete ? ' active' : ' muted'}`}
              onClick={() => { setComplete((v) => !v); setTimer(false); }}>
              <span className="qa-pill-label">{complete ? '✓ Complete on add' : 'Mark complete'}</span>
            </button>
            <button type="button" className={`qa-pill${timer ? ' active' : ' muted'}`}
              onClick={() => { setTimer((v) => !v); setComplete(false); }}>
              <span className="qa-pill-label">{timer ? '◷ Timer on add' : 'Start timer'}</span>
            </button>
          </div>

          <div className="qa-footer pv-flat">
            <div className="qa-hint"><span><b>Enter</b> to add · <b>Esc</b> to dismiss</span></div>
            <button type="button" className="qa-add-btn">Add a Task</button>
          </div>

          <div className="pv-payload">
            <div className="pv-payload-title">Payload this would send on Add</div>
            <pre>{JSON.stringify({ list_id: locId, title, task_type_id: typeId, status, priority, work_date: workDate, start_date: startDate, due_date: dueDate, assignee_ids: assignees, labels }, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
