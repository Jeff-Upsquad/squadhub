import { useState } from 'react';

type Status = 'prog' | 'todo' | 'review' | 'done';
type Priority = 'p0' | 'p1' | 'p2';

type Row = {
  id: string;
  title: string;
  tag: 'client' | 'ops' | 'eng' | 'design' | 'space';
  tagLabel: string;
  who: string;
  color: string;
  aname: string;
  prio: Priority;
  status: Status;
  due: string;
  dueCls: '' | 'today' | 'overdue';
};

type Group = {
  id: string;
  label: string;
  count: number;
  dot: 'gd-todo' | 'gd-prog' | 'gd-review' | 'gd-done';
  rows: Row[];
};

const GROUPS: Group[] = [
  {
    id: 'prog', label: 'In Progress', count: 4, dot: 'gd-prog',
    rows: [
      { id: 'SQ-204', title: 'Mobile pricing a11y — fix touch targets + contrast', tag: 'client', tagLabel: 'Arbor', who: 'LS', color: 'oklch(0.62 0.13 320)', aname: 'Leo Sato', prio: 'p0', status: 'prog', due: 'Today 18:00', dueCls: 'today' },
      { id: 'SQ-198', title: 'Q2 launch copy — brand voice pass', tag: 'ops', tagLabel: 'Q2', who: 'MH', color: 'oklch(0.58 0.12 60)', aname: 'Maya H.', prio: 'p1', status: 'prog', due: 'Today', dueCls: 'today' },
      { id: 'SQ-187', title: 'Auth migration — phase 2 → In Review', tag: 'eng', tagLabel: 'Eng', who: 'DK', color: 'oklch(0.6 0.13 150)', aname: 'Dev K.', prio: 'p1', status: 'review', due: 'Tomorrow', dueCls: '' },
      { id: 'SQ-181', title: 'Lumen MSA v3 — legal review', tag: 'client', tagLabel: 'Lumen', who: 'NI', color: 'oklch(0.62 0.12 100)', aname: 'Nina I.', prio: 'p2', status: 'prog', due: 'Apr 24', dueCls: '' },
    ],
  },
  {
    id: 'todo', label: 'To do', count: 6, dot: 'gd-todo',
    rows: [
      { id: 'SQ-212', title: 'Arbor motion — ship A variant for case-study page', tag: 'design', tagLabel: 'Design', who: 'TZ', color: 'oklch(0.6 0.13 210)', aname: 'Tomás Z.', prio: 'p2', status: 'todo', due: 'Apr 28', dueCls: '' },
      { id: 'SQ-210', title: 'Invite Arbor QA team to staging', tag: 'ops', tagLabel: 'Ops', who: 'MH', color: 'oklch(0.58 0.12 60)', aname: 'Maya H.', prio: 'p2', status: 'todo', due: 'Apr 22', dueCls: '' },
      { id: 'SQ-209', title: 'Rewrite onboarding — step 3 empty state', tag: 'design', tagLabel: 'Design', who: 'LS', color: 'oklch(0.62 0.13 320)', aname: 'Leo Sato', prio: 'p2', status: 'todo', due: 'Apr 25', dueCls: '' },
      { id: 'SQ-207', title: 'Set up billing webhooks on prod', tag: 'eng', tagLabel: 'Eng', who: 'PR', color: 'oklch(0.62 0.13 260)', aname: 'Priya R.', prio: 'p1', status: 'todo', due: 'Apr 21', dueCls: 'today' },
      { id: 'SQ-199', title: 'Draft Q3 roadmap doc — first pass', tag: 'space', tagLabel: 'Ops', who: 'AM', color: 'oklch(0.6 0.12 30)', aname: 'Arjun M.', prio: 'p2', status: 'todo', due: 'Apr 30', dueCls: '' },
      { id: 'SQ-192', title: 'Archive 2023 docs from Arbor space', tag: 'ops', tagLabel: 'Ops', who: 'MH', color: 'oklch(0.58 0.12 60)', aname: 'Maya H.', prio: 'p2', status: 'todo', due: 'May 2', dueCls: '' },
    ],
  },
  {
    id: 'over', label: 'Overdue', count: 2, dot: 'gd-prog',
    rows: [
      { id: 'SQ-176', title: 'Client feedback log — consolidate Mar + Apr', tag: 'ops', tagLabel: 'Ops', who: 'AM', color: 'oklch(0.6 0.12 30)', aname: 'Arjun M.', prio: 'p1', status: 'todo', due: 'Apr 15', dueCls: 'overdue' },
      { id: 'SQ-170', title: 'Update SquadHub style-guide for clients', tag: 'design', tagLabel: 'Design', who: 'LS', color: 'oklch(0.62 0.13 320)', aname: 'Leo Sato', prio: 'p2', status: 'todo', due: 'Apr 17', dueCls: 'overdue' },
    ],
  },
  {
    id: 'done', label: 'Recently shipped', count: 3, dot: 'gd-done',
    rows: [
      { id: 'SQ-189', title: 'Payments refactor', tag: 'eng', tagLabel: 'Eng', who: 'PR', color: 'oklch(0.62 0.13 260)', aname: 'Priya R.', prio: 'p0', status: 'done', due: 'Apr 17', dueCls: '' },
      { id: 'SQ-184', title: 'Arbor homepage v3', tag: 'client', tagLabel: 'Arbor', who: 'LS', color: 'oklch(0.62 0.13 320)', aname: 'Leo Sato', prio: 'p0', status: 'done', due: 'Apr 16', dueCls: '' },
      { id: 'SQ-182', title: 'Daily check-in bot — onboarding flow', tag: 'ops', tagLabel: 'Ops', who: 'MH', color: 'oklch(0.58 0.12 60)', aname: 'Maya H.', prio: 'p2', status: 'done', due: 'Apr 15', dueCls: '' },
    ],
  },
];

const STATUS_PREFIX: Record<Status, string> = { prog: '● ', done: '✓ ', review: '◐ ', todo: '○ ' };
const STATUS_LABEL: Record<Status, string> = { prog: 'Prog', todo: 'Todo', review: 'Review', done: 'Done' };

type Filter = 'mine' | 'created' | 'sub' | 'all';

export default function MyTasksView() {
  const [filter, setFilter] = useState<Filter>('mine');

  return (
    <div className="sh-view h-full overflow-y-auto">
      <div className="tasks">
        <div className="tasks-head">
          <div>
            <div className="eyebrow">Tasks · 15 active</div>
            <h1>Your work, across six spaces.</h1>
            <div className="sub">Sorted by priority, then due date. Grouped by status.</div>
          </div>
          <div>
            <div className="top-btn ghost-border">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 5h18l-7 9v5l-4 2v-7z" /></svg>
              Filter
            </div>
            <div className="top-btn ghost-border">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M5.5 18.5l2.8-2.8M15.7 8.3l2.8-2.8" /></svg>
              AI sort
            </div>
            <div className="top-btn primary">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
              New task
            </div>
          </div>
        </div>

        <div className="tasks-filters">
          <div className="pill" data-active={filter === 'mine'} onClick={() => setFilter('mine')}>Assigned to me</div>
          <div className="pill" data-active={filter === 'created'} onClick={() => setFilter('created')}>Created by me</div>
          <div className="pill" data-active={filter === 'sub'} onClick={() => setFilter('sub')}>Subscribed</div>
          <div className="pill" data-active={filter === 'all'} onClick={() => setFilter('all')}>All tasks</div>
        </div>

        <div className="task-table">
          <div className="task-col-head">
            <span />
            <span>Task</span>
            <span>Assignee</span>
            <span>Priority</span>
            <span>Status</span>
            <span>Due</span>
            <span>Space</span>
          </div>
          {GROUPS.map((g) => (
            <div key={g.id} className="task-group">
              <div className="task-group-head">
                <span className={`group-dot ${g.dot}`} />
                {g.label}
                <span className="num">· {g.count}</span>
              </div>
              {g.rows.map((r) => (
                <div key={r.id} className="task-row">
                  <div className="checkbox" data-done={r.status === 'done'} />
                  <div>
                    <div className="t-title">
                      <span className="mini-tag">{r.id}</span>
                      <span>{r.title}</span>
                    </div>
                  </div>
                  <div className="t-ava">
                    <div className="ava" style={{ background: r.color, fontWeight: 600 }}>{r.who}</div>
                    <span className="a-name">{r.aname}</span>
                  </div>
                  <div className={`priority ${r.prio}`}>
                    <span className="dots"><span className="d" /><span className="d" /><span className="d" /></span>
                    {r.prio.toUpperCase()}
                  </div>
                  <div>
                    <span className={`status-pill ${r.status}`}>
                      {STATUS_PREFIX[r.status]}
                      {STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <div className={`due ${r.dueCls}`}>{r.due}</div>
                  <div><span className={`tag ${r.tag}`} style={{ fontSize: 10 }}>{r.tagLabel}</span></div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
