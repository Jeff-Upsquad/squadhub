'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Icon, { type IconName } from './PreviewIcon';
import { FAVORITES, INITIAL_TASKS, type Task } from './preview-data';
import './preview.css';

type View = 'focus' | 'completed' | 'new' | 'today' | 'overdue' | 'tomorrow' | 'all' | 'recordings' | 'favorite';
type Modal = 'search' | 'create' | 'customize' | 'profile' | 'help' | 'notifications' | null;
type TimerMode = 'idle' | 'work' | 'break' | 'no_work';

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`sp-brand-mark ${small ? 'sp-brand-small' : ''}`} aria-hidden="true">S</span>;
}

function Dialog({ children, title, onClose, wide = false }: { children: ReactNode; title: string; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className={`sp-dialog ${wide ? 'sp-dialog-wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}>
      <div className="sp-dialog-head"><h2>{title}</h2><button className="sp-icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </dialog>
  );
}

function Avatar({ who, small = false }: { who: string; small?: boolean }) {
  return <span className={`sp-avatar sp-avatar-${who.toLowerCase()} ${small ? 'sp-avatar-small' : ''}`} title={who === 'J' ? 'Jeff Zeena' : who === 'SK' ? 'Sanjay Kumar' : 'Anjali Menon'}>{who}</span>;
}

const railItems: { icon: IconName; label: string }[] = [
  { icon: 'home', label: 'Home' },
  { icon: 'inbox', label: 'Inbox' },
  { icon: 'circleCheck', label: 'Tasks' },
  { icon: 'document', label: 'Docs' },
  { icon: 'calendar', label: 'Cal' },
  { icon: 'grid', label: 'Apps' },
  { icon: 'resource', label: 'Resources' },
  { icon: 'hourglass', label: 'Timesheet' },
];

const appItems: { icon: IconName; label: string }[] = [
  { icon: 'circleCheck', label: 'Daily Check-In' },
  { icon: 'clock', label: 'Time Management' },
  { icon: 'calendar', label: 'My Meetings' },
  { icon: 'video', label: 'Squad Clips' },
];

const viewNames: Record<View, string> = {
  focus: 'Focus list', completed: 'Completed', new: 'New tasks', today: 'Today',
  overdue: 'Overdue', tomorrow: 'Tomorrow', all: 'All tasks', recordings: 'Recordings', favorite: 'Favorites',
};
const storageKey = 'squadhub-design-preview-v1';

function formatWorked(total: number) {
  const m = Math.floor(total / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

export default function SquadHomePreview() {
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('focus');
  const [favorite, setFavorite] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [appsOpen, setAppsOpen] = useState(true);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const [areasOpen, setAreasOpen] = useState(true);
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [dmsOpen, setDmsOpen] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [priority, setPriority] = useState('All priorities');
  const [groupBy, setGroupBy] = useState('None');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [dayVisible, setDayVisible] = useState(false);
  const [compact, setCompact] = useState(false);
  const [note, setNote] = useState('');
  const [selectedDay, setSelectedDay] = useState(9);
  const [timerMode, setTimerMode] = useState<TimerMode>('idle');
  const [workedSeconds, setWorkedSeconds] = useState(0);
  const [breakSeconds, setBreakSeconds] = useState(0);
  const [timerNow, setTimerNow] = useState(Date.now());
  const [timerStarted, setTimerStarted] = useState<number | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && Array.isArray(saved.tasks) && saved.tasks.every((t: Task) => typeof t.id === 'string' && typeof t.title === 'string' && typeof t.list === 'string' && typeof t.space === 'string' && typeof t.assignee === 'string' && typeof t.done === 'boolean' && typeof t.focus === 'boolean' && typeof t.isNew === 'boolean' && ['High', 'Medium', 'Low'].includes(t.priority) && ['Today', 'Tomorrow', 'Overdue', 'Sep 11', 'Sep 14'].includes(t.due))) setTasks(saved.tasks);
      if (typeof saved?.note === 'string') setNote(saved.note);
      if (typeof saved?.dayVisible === 'boolean') setDayVisible(saved.dayVisible);
      if (typeof saved?.compact === 'boolean') setCompact(saved.compact);
    } catch { /* A fresh preview also works when browser storage is unavailable. */ }
    setReady(true);
    if (window.innerWidth < 1000) setSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (ready) { try { localStorage.setItem(storageKey, JSON.stringify({ tasks, note, dayVisible, compact })); } catch { /* Keep in-memory changes usable. */ } }
  }, [tasks, note, dayVisible, compact, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setSelectedTask(null); setModal(prev => prev === 'search' ? null : 'search'); setSearch('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (timerMode === 'idle') return;
    const id = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timerMode]);

  const notifyPreview = (label: string) => setToast(`${label} is outside this first preview. Explore My home for now.`);
  const openSearch = () => { setSearch(''); setModal('search'); };
  const navigate = (next: View) => { setView(next); setPriority('All priorities'); setCollapsedGroups([]); if (window.innerWidth < 1000) setSidebarOpen(false); };
  const toggleTask = (id: string) => setTasks(current => current.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const openTasks = tasks.filter(t => !t.done);
  const counts = {
    new: openTasks.filter(t => t.isNew).length,
    today: openTasks.filter(t => t.due === 'Today').length,
    overdue: openTasks.filter(t => t.due === 'Overdue').length,
    tomorrow: openTasks.filter(t => t.due === 'Tomorrow').length,
    all: openTasks.length,
    focus: openTasks.filter(t => t.focus).length,
    completed: tasks.filter(t => t.done).length,
  };

  const filteredTasks = useMemo(() => tasks.filter(t => {
    if (priority !== 'All priorities' && t.priority !== priority) return false;
    switch (view) {
      case 'focus': return t.focus && !t.done;
      case 'completed': return t.done;
      case 'new': return t.isNew && !t.done;
      case 'today': return t.due === 'Today' && !t.done;
      case 'overdue': return t.due === 'Overdue' && !t.done;
      case 'tomorrow': return t.due === 'Tomorrow' && !t.done;
      case 'recordings': return t.list === 'Recording Tasks' && !t.done;
      case 'favorite': return t.list === favorite;
      default: return !t.done;
    }
  }), [tasks, view, priority, favorite]);

  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    filteredTasks.forEach(t => {
      const key = groupBy === 'Space' ? t.space : groupBy === 'Priority' ? `${t.priority} priority` : 'All tasks';
      map.set(key, [...(map.get(key) || []), t]);
    });
    return [...map.entries()];
  }, [filteredTasks, groupBy]);

  const detail = tasks.find(t => t.id === selectedTask);
  const elapsed = timerStarted ? Math.max(0, Math.floor((timerNow - timerStarted) / 1000)) : 0;
  const workTotal = workedSeconds + (timerMode === 'work' ? elapsed : 0);
  const breakTotal = breakSeconds + (timerMode === 'break' ? elapsed : 0);
  const changeTimer = (mode: TimerMode) => {
    const stamp = Date.now();
    const segment = timerStarted ? Math.max(0, Math.floor((stamp - timerStarted) / 1000)) : 0;
    if (timerMode === 'work') setWorkedSeconds(s => s + segment);
    if (timerMode === 'break') setBreakSeconds(s => s + segment);
    setTimerMode(mode === timerMode ? 'idle' : mode);
    setTimerStarted(mode === timerMode ? null : stamp);
    setTimerNow(stamp);
  };

  const commitment = 9 * 3600;
  const workPct = Math.min(100, (workTotal / commitment) * 100);

  const summary: { key: 'new' | 'today' | 'overdue' | 'tomorrow' | 'all'; icon: IconName; label: string; unit: string; caption: (n: number) => string }[] = [
    { key: 'new', icon: 'inbox', label: 'New Tasks', unit: 'to review', caption: n => n ? 'Waiting for you' : 'All reviewed' },
    { key: 'today', icon: 'calendar', label: 'Today', unit: 'items', caption: n => n ? 'On your plate' : 'Nothing on your plate' },
    { key: 'overdue', icon: 'clock', label: 'Overdue', unit: '', caption: n => n ? 'Pick these up first' : 'All clear' },
    { key: 'tomorrow', icon: 'sun', label: 'Tomorrow', unit: 'items', caption: n => n ? 'A look ahead' : 'Wide open' },
    { key: 'all', icon: 'layers', label: 'All tasks', unit: 'items', caption: n => n ? 'Everything assigned' : 'Nothing assigned' },
  ];

  return (
    <div data-ready={ready} className={`sp-root ${sidebarOpen ? '' : 'sp-sidebar-collapsed'} ${compact ? 'sp-compact' : ''}`}>
      <a className="sp-skip" href="#sp-main">Skip to content</a>

      <nav className="sp-rail" aria-label="Main navigation">
        <button className="sp-logo-button" aria-label="SquadHub home" onClick={() => navigate('focus')}><BrandMark /></button>
        <div className="sp-rail-links">
          {railItems.map(({ icon, label }) => (
            <button
              key={label}
              className={`sp-rail-item ${label === 'Home' ? 'sp-rail-active' : ''}`}
              aria-label={label}
              aria-current={label === 'Home' ? 'page' : undefined}
              onClick={() => label === 'Home' ? navigate('focus') : label === 'Tasks' ? navigate('all') : notifyPreview(label)}
            >
              <span className="sp-rail-icon">
                <Icon name={icon} size={21} />
                {label === 'Inbox' && <i className="sp-rail-notification" />}
              </span>
              <span>{label}</span>
            </button>
          ))}
          <span className="sp-rail-divider" />
          <button className="sp-rail-item" onClick={() => setModal('help')}>
            <span className="sp-rail-icon"><Icon name="more" size={21} /></span>
            <span>More</span>
          </button>
        </div>
        <div className="sp-rail-bottom">
          <button className="sp-rail-utility" aria-label="Help and shortcuts" onClick={() => setModal('help')}><Icon name="lifebuoy" size={20} /></button>
          <button className="sp-rail-utility" aria-label="Appearance" onClick={() => setModal('customize')}><Icon name="moon" size={20} /></button>
          <button className="sp-profile" aria-label="Jeff’s profile" onClick={() => setModal('profile')}><span>JZ</span><i /></button>
        </div>
      </nav>

      {sidebarOpen && <button className="sp-sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <aside className="sp-sidebar" aria-label="Home sidebar" inert={!sidebarOpen}>
        <div className="sp-workspace">
          <BrandMark small />
          <span>
            <strong>SquadHub</strong>
            <small>Powered by UpSquad</small>
          </span>
          <span className="sp-history">
            <button aria-label="Go back" onClick={() => notifyPreview('History')}><Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} /></button>
            <button aria-label="Go forward" onClick={() => notifyPreview('History')}><Icon name="chevron" size={14} /></button>
          </span>
        </div>
        <button className="sp-search-trigger" onClick={openSearch}>
          <Icon name="search" size={15} />
          <span>Search or jump to...</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="sp-sidebar-scroll">
          <div className="sp-primary-nav">
            <button className={`sp-nav-item ${view === 'focus' ? 'sp-nav-active' : ''}`} onClick={() => navigate('focus')} aria-current={view === 'focus' ? 'page' : undefined}><Icon name="home" /><span>My home</span></button>
            <button className="sp-nav-item" onClick={() => notifyPreview('Inbox')}><Icon name="inbox" /><span>Inbox</span><span className="sp-nav-count">9</span></button>
            <button className="sp-nav-item" onClick={() => { setDayVisible(true); setSelectedDay(9); setToast('Your day is open on the right.'); if (window.innerWidth < 1000) setSidebarOpen(false); }}><Icon name="clock" /><span>Day Planner</span></button>
            <button className="sp-nav-item" onClick={() => notifyPreview('Routines')}><Icon name="repeat" /><span>Routines</span></button>
            <button className={`sp-nav-item ${view === 'all' ? 'sp-nav-active' : ''}`} onClick={() => navigate('all')}><Icon name="circleCheck" /><span>My Tasks</span></button>
          </div>

          <button className="sp-section-toggle" onClick={() => setAppsOpen(!appsOpen)} aria-expanded={appsOpen}><Icon name="down" size={11} className={appsOpen ? '' : 'sp-rotated'} /><span>Apps</span></button>
          {appsOpen && (
            <div className="sp-collapsible">
              {appItems.map(item => (
                <button className="sp-nav-item" key={item.label} onClick={() => notifyPreview(item.label)}>
                  <Icon name={item.icon} /><span>{item.label}</span>
                </button>
              ))}
            </div>
          )}

          <button className="sp-section-toggle" onClick={() => setFavoritesOpen(!favoritesOpen)} aria-expanded={favoritesOpen}><Icon name="down" size={11} className={favoritesOpen ? '' : 'sp-rotated'} /><span>Favorites</span></button>
          {favoritesOpen && (
            <div className="sp-collapsible">
              {FAVORITES.slice(0, 5).map((name, index) => (
                <button className={`sp-nav-item sp-favorite ${favorite === name && view === 'favorite' ? 'sp-favorite-selected' : ''}`} key={name} onClick={() => { setFavorite(name); navigate('favorite'); }}>
                  <Icon name={index === 4 ? 'layers' : 'folder'} size={15} /><span>{name}</span>
                </button>
              ))}
            </div>
          )}

          <button className="sp-section-toggle" onClick={() => notifyPreview('Workspaces')}><Icon name="down" size={11} className="sp-rotated" /><span>Workspaces</span></button>
          <p className="sp-empty-hint">No workspaces yet</p>

          <button className="sp-section-toggle" onClick={() => setAreasOpen(!areasOpen)} aria-expanded={areasOpen}><Icon name="down" size={11} className={areasOpen ? '' : 'sp-rotated'} /><span>Areas</span></button>
          {areasOpen && (
            <div className="sp-collapsible">
              <button className="sp-nav-item" onClick={() => notifyPreview('Ops')}><span className="sp-area-tag">OP</span><span>Ops</span></button>
            </div>
          )}

          <button className="sp-section-toggle" onClick={() => setChannelsOpen(!channelsOpen)} aria-expanded={channelsOpen}><Icon name="down" size={11} className={channelsOpen ? '' : 'sp-rotated'} /><span>Channels</span></button>
          {channelsOpen && (
            <div className="sp-collapsible">
              <button className="sp-nav-item" onClick={() => notifyPreview('# general')}><Icon name="hash" size={14} /><span>general</span></button>
              <button className="sp-nav-item" onClick={() => notifyPreview('# daily-ops')}><Icon name="hash" size={14} /><span>daily-ops</span></button>
              <button className="sp-nav-item sp-add-link" onClick={() => notifyPreview('Add channels')}><Icon name="plus" size={13} /><span>Add channels</span></button>
            </div>
          )}

          <button className="sp-section-toggle" onClick={() => setDmsOpen(!dmsOpen)} aria-expanded={dmsOpen}><Icon name="down" size={11} className={dmsOpen ? '' : 'sp-rotated'} /><span>Direct messages</span></button>
          {dmsOpen && (
            <div className="sp-collapsible">
              <button className="sp-nav-item sp-add-link" onClick={() => notifyPreview('New direct message')}><Icon name="plus" size={13} /><span>New direct message</span></button>
            </div>
          )}

          <button className="sp-section-toggle" onClick={() => notifyPreview('CRM chats')}><Icon name="down" size={11} className="sp-rotated" /><span>CRM chats</span></button>
          <p className="sp-empty-hint">Open a deal or start a team chat</p>
        </div>
      </aside>

      <div className="sp-workspace-main">
        <header className="sp-topbar">
          <button className="sp-icon-button" aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} onClick={() => setSidebarOpen(!sidebarOpen)}><Icon name="panel" size={20} /></button>
          <span className="sp-home-tab">My home</span>
          <div className="sp-topbar-right">
            <button className="sp-icon-button" aria-label="Search tasks" onClick={openSearch}><Icon name="search" size={20} /></button>
            <button className="sp-icon-button sp-bell" aria-label="Notifications" onClick={() => setModal('notifications')}><Icon name="bell" size={20} /><i /></button>
          </div>
        </header>

        <main className="sp-main" id="sp-main" tabIndex={-1}>
          <section className="sp-hero sp-enter" aria-label="Welcome">
            <div className="sp-greeting">
              <p className="sp-eyebrow">Wednesday, Sep 9 · Week 37 · Q3</p>
              <h1>Good morning, Jeff<span>.</span></h1>
              <p>The hard part is starting. You already did that.</p>
            </div>
            <div className={`sp-timer ${timerMode !== 'idle' ? 'sp-timer-running' : ''}`} data-state={timerMode}>
              <div className="sp-timer-meter">
                <span className="sp-worked">{formatWorked(workTotal)}<em>worked</em></span>
                <div className="sp-progress-track" role="progressbar" aria-label="Workday progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(workPct)}>
                  <span className="sp-seg-work" style={{ width: `${workPct}%` }} />
                  <span className="sp-seg-break" style={{ width: `${Math.min(12, breakTotal / 36)}%` }} />
                </div>
                <div className="sp-timer-readout">
                  <span>of 9h</span>
                  <span className={`sp-timer-status sp-status-${timerMode}`}>
                    <i />
                    {timerMode === 'work' ? 'Working' : timerMode === 'break' ? 'On a break' : timerMode === 'no_work' ? 'Off task' : 'Not tracking'}
                  </span>
                </div>
              </div>
              <div className="sp-timer-actions">
                {(['work', 'break', 'no_work'] as const).map(mode => (
                  <button key={mode} className={timerMode === mode ? 'sp-timer-selected' : ''} onClick={() => changeTimer(mode)}>
                    <Icon name={timerMode === mode ? 'stop' : 'play'} size={11} />
                    {timerMode === mode ? 'Stop' : mode === 'no_work' ? 'No work' : mode === 'work' ? 'Work' : 'Break'}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="sp-summary sp-enter" aria-label="Task overview">
            {summary.map(stat => (
              <button key={stat.key} className={`sp-stat sp-stat-${stat.key} ${view === stat.key ? 'sp-stat-selected' : ''}`} aria-pressed={view === stat.key} onClick={() => navigate(view === stat.key ? 'focus' : stat.key)}>
                <span className="sp-stat-top">
                  <span className="sp-stat-icon"><Icon name={stat.icon} size={13} /></span>
                  {stat.label}
                  {stat.key === 'new' && counts.new > 0 && <i className="sp-stat-ping" />}
                  <Icon name="upRight" size={11} className="sp-stat-arrow" />
                </span>
                <span className="sp-stat-number">
                  {counts[stat.key]}
                  {stat.unit && <span>{stat.unit}</span>}
                </span>
                <span className="sp-stat-caption">{stat.caption(counts[stat.key])}</span>
              </button>
            ))}
          </section>

          <div className="sp-attention-bar sp-enter">
            <button className={`sp-attention-pill ${view === 'recordings' ? 'sp-pill-selected' : ''}`} onClick={() => navigate(view === 'recordings' ? 'focus' : 'recordings')}>
              <Icon name="document" size={13} />SOPs<span>1</span>
            </button>
          </div>

          <div className={`sp-content-grid sp-enter ${dayVisible ? '' : 'sp-no-day'}`}>
            <section className="sp-focus-panel" aria-label="Your tasks">
              <div className="sp-focus-header">
                <h2>{view === 'favorite' ? favorite : viewNames[view]}<span className="sp-heading-count">{filteredTasks.length}</span></h2>
                <div className="sp-table-controls">
                  <label className="sp-group-select">
                    <span>Group</span>
                    <select aria-label="Group tasks" value={groupBy} onChange={e => { setGroupBy(e.target.value); setCollapsedGroups([]); }}>
                      <option>None</option>
                      <option>Space</option>
                      <option>Priority</option>
                    </select>
                    <Icon name="down" size={11} />
                  </label>
                  <button className="sp-icon-button" aria-label="Open day planner" onClick={() => setDayVisible(v => !v)}><Icon name="calendar" size={16} /></button>
                </div>
              </div>

              <div className="sp-task-groups">
                {groups.map(([name, rows], index) => (
                  <div className="sp-task-group" key={name}>
                    {groupBy !== 'None' && (
                      <button className="sp-group-heading" onClick={() => setCollapsedGroups(current => current.includes(name) ? current.filter(g => g !== name) : [...current, name])} aria-expanded={!collapsedGroups.includes(name)}>
                        <span className={`sp-space-icon sp-space-${index % 2}`}><Icon name={name.includes('Client') ? 'briefcase' : 'layers'} size={14} /></span>
                        <span>{name}</span>
                        <span className="sp-group-count">{rows.length}</span>
                        <Icon name="down" size={13} className={collapsedGroups.includes(name) ? 'sp-rotated' : ''} />
                      </button>
                    )}
                    {!collapsedGroups.includes(name) && rows.map(task => (
                      <article className={`sp-task-row ${task.done ? 'sp-task-done' : ''}`} key={task.id}>
                        <button role="checkbox" aria-checked={task.done} className="sp-checkbox" aria-label={`${task.done ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => toggleTask(task.id)}>
                          <span><Icon name="check" size={11} /></span>
                        </button>
                        <button className="sp-task-title" onClick={() => setSelectedTask(task.id)}>{task.title}</button>
                        <span className={`sp-due-date sp-due-${task.due.toLowerCase()}`}>{task.due}</span>
                        <span className={`sp-priority sp-priority-${task.priority.toLowerCase()}`}>{task.priority}</span>
                        <Avatar who={task.assignee} small />
                        <button className={`sp-save-action ${task.focus ? 'sp-is-saved' : ''}`} aria-label={`${task.focus ? 'Remove' : 'Add'} ${task.title} ${task.focus ? 'from' : 'to'} focus list`} aria-pressed={task.focus} onClick={() => setTasks(current => current.map(t => t.id === task.id ? { ...t, focus: !t.focus } : t))}>
                          <Icon name="star" size={15} />
                        </button>
                      </article>
                    ))}
                  </div>
                ))}
              </div>

              {!filteredTasks.length && (
                <div className="sp-empty">
                  <span className="sp-empty-rule" />
                  <p>{view === 'focus' ? 'Nothing starred yet. Star a task (★) and it shows up here.' : priority !== 'All priorities' ? 'No tasks match this priority.' : 'Nothing here yet. Add one when you’re ready.'}</p>
                </div>
              )}
            </section>

            {dayVisible && (
              <aside className="sp-day-column" aria-label="Your day">
                <section className="sp-day-card">
                  <div className="sp-aside-heading"><h2>Your day</h2><Icon name="calendar" size={16} /></div>
                  <div className="sp-week-strip">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                      <button key={i} aria-label={`September ${i + 7}`} aria-pressed={selectedDay === i + 7} className={selectedDay === i + 7 ? 'sp-day-selected' : ''} onClick={() => setSelectedDay(i + 7)}>
                        <span>{d}</span><strong>{i + 7}</strong>
                      </button>
                    ))}
                  </div>
                  {selectedDay === 9 ? (
                    <button className="sp-event" onClick={() => setToast('Team sync · 4:30–5:00 PM')}>
                      <span className="sp-event-line" />
                      <div><strong>Team sync</strong><span>4:30 – 5:00 PM</span></div>
                    </button>
                  ) : (
                    <div className="sp-free-day"><span>Your schedule is clear.</span></div>
                  )}
                </section>
                <section className="sp-note-card">
                  <div className="sp-aside-heading">
                    <h2>A note</h2>
                    <button className="sp-icon-button" aria-label="Focus note" onClick={() => noteRef.current?.focus()}><Icon name="edit" size={15} /></button>
                  </div>
                  <textarea ref={noteRef} aria-label="Personal quick note" placeholder="What’s on your mind?" value={note} maxLength={2000} onChange={e => setNote(e.target.value)} />
                </section>
              </aside>
            )}
          </div>
        </main>
      </div>

      {toast && (
        <div className="sp-toast" role="status">
          <Icon name="circleCheck" size={16} />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}><Icon name="close" size={14} /></button>
        </div>
      )}

      {modal === 'search' && (
        <Dialog title="Search" onClose={() => setModal(null)} wide>
          <div className="sp-search-field">
            <Icon name="search" size={18} />
            <input autoFocus aria-label="Search tasks and favorites" placeholder="Search or jump to..." value={search} onChange={e => setSearch(e.target.value)} />
            <kbd>ESC</kbd>
          </div>
          <div className="sp-search-results">
            <span className="sp-modal-eyebrow">{search ? 'Matching tasks' : 'Your focus tasks'}</span>
            {tasks.filter(t => search ? `${t.title} ${t.list} ${t.space}`.toLowerCase().includes(search.toLowerCase()) : t.focus && !t.done).slice(0, 9).map(t => (
              <button className="sp-search-result" key={t.id} onClick={() => { setModal(null); setSelectedTask(t.id); }}>
                <Icon name={t.done ? 'circleCheck' : 'document'} size={16} />
                <span>{t.title}<small>{t.space} / {t.list}</small></span>
              </button>
            ))}
            {search && !tasks.some(t => `${t.title} ${t.list} ${t.space}`.toLowerCase().includes(search.toLowerCase())) && <div className="sp-empty"><p>No matches yet.</p></div>}
          </div>
        </Dialog>
      )}

      {modal === 'create' && (
        <Dialog title="New task" onClose={() => setModal(null)}>
          <form className="sp-task-form" onSubmit={e => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const title = String(form.get('title') || '').trim();
            if (!title) return;
            const task: Task = {
              id: crypto.randomUUID(), title, list: String(form.get('list')), space: "Jeff’s space",
              due: form.get('due') as Task['due'], priority: form.get('priority') as Task['priority'],
              assignee: 'J', focus: true, isNew: true, done: false, description: String(form.get('description') || ''),
            };
            setTasks(current => [...current, task]);
            setModal(null);
            navigate('focus');
            setToast('Added to your focus list.');
          }}>
            <label>Task name<input name="title" placeholder="What would you like to get done?" required maxLength={160} autoFocus /></label>
            <div className="sp-form-columns">
              <label>Due date<select name="due"><option>Today</option><option>Tomorrow</option><option>Sep 11</option><option>Sep 14</option></select></label>
              <label>Priority<select name="priority" defaultValue="Medium"><option>High</option><option>Medium</option><option>Low</option></select></label>
            </div>
            <label>List<select name="list"><option>My Tasks</option><option>Squadbooks</option><option>SquadHire</option></select></label>
            <div className="sp-form-actions"><span>Added to your focus list</span><button className="sp-primary-button" type="submit">Create</button></div>
          </form>
        </Dialog>
      )}

      {detail && (
        <Dialog title="Task" onClose={() => setSelectedTask(null)}>
          <div className="sp-detail">
            <span className="sp-modal-eyebrow">{detail.space} / {detail.list}</span>
            <h3>{detail.title}</h3>
            <div className="sp-detail-meta">
              <span><Icon name="calendar" size={15} />{detail.due}</span>
              <span className={`sp-priority sp-priority-${detail.priority.toLowerCase()}`}>{detail.priority}</span>
              <Avatar who={detail.assignee} />
            </div>
            <label className="sp-detail-description">Note<textarea aria-label="Task description" value={detail.description || ''} placeholder="Add a little more context..." onChange={e => setTasks(current => current.map(t => t.id === detail.id ? { ...t, description: e.target.value } : t))} /></label>
            <div className="sp-form-actions">
              <button className="sp-text-button" onClick={() => setTasks(current => current.map(t => t.id === detail.id ? { ...t, focus: !t.focus } : t))}>{detail.focus ? 'Remove from focus' : 'Add to focus'}</button>
              <button className="sp-primary-button" onClick={() => { toggleTask(detail.id); setSelectedTask(null); }}>{detail.done ? 'Reopen' : 'Mark complete'}</button>
            </div>
          </div>
        </Dialog>
      )}

      {modal === 'customize' && (
        <Dialog title="Display" onClose={() => setModal(null)}>
          <div className="sp-customize">
            <label>
              <span><strong>Your day</strong><small>Keep the schedule beside My home.</small></span>
              <input type="checkbox" role="switch" checked={dayVisible} onChange={e => setDayVisible(e.target.checked)} />
            </label>
            <label>
              <span><strong>Compact list</strong><small>Less space between tasks.</small></span>
              <input type="checkbox" role="switch" checked={compact} onChange={e => setCompact(e.target.checked)} />
            </label>
            <div className="sp-font-preview">
              <span>Aa</span>
              <div><strong>Mona Sans</strong><small>Threads-adjacent geometric sans. Optimistic isn’t publicly licensed, so this is the closest open-source match.</small></div>
            </div>
            <button className="sp-primary-button" onClick={() => setModal(null)}>Done</button>
          </div>
        </Dialog>
      )}

      {modal === 'profile' && (
        <Dialog title="Workspace" onClose={() => setModal(null)}>
          <div className="sp-profile-detail">
            <Avatar who="J" />
            <h3>Jeff Zeena</h3>
            <p>SquadHub · Personal workspace</p>
            <div className="sp-preview-info">This UI preview is local only. Other pages are not designed in this pass.</div>
            <button className="sp-primary-button" onClick={() => setModal('customize')}>Display settings</button>
          </div>
        </Dialog>
      )}

      {modal === 'help' && (
        <Dialog title="Preview" onClose={() => setModal(null)}>
          <div className="sp-help">
            <p>This pass covers the icon rail, sidebar, and My home.</p>
            <div><Icon name="search" /><span>Search</span><kbd>⌘K</kbd></div>
            <div><Icon name="circleCheck" /><span>Complete a task from the list</span></div>
            <div><Icon name="clock" /><span>Start Work, Break, or No work</span></div>
            <p className="sp-help-footnote">Inbox, Docs, Calendar, Apps, and the rest of the product stay on the current design until a later pass.</p>
          </div>
        </Dialog>
      )}

      {modal === 'notifications' && (
        <Dialog title="Notifications" onClose={() => setModal(null)}>
          <div className="sp-notifications">
            <button onClick={() => { setModal(null); navigate('new'); }}>
              <span><strong>{counts.new} new tasks</strong><small>Review when you have a moment.</small></span>
            </button>
            <button onClick={() => { setModal(null); navigate('overdue'); }}>
              <span><strong>{counts.overdue} overdue</strong><small>A good place to pick the next thing.</small></span>
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
