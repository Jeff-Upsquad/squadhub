import { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';

type Task = {
  id: number;
  title: string;
  space: string;
  when: string;
  tag: 'client' | 'ops' | 'eng' | 'design' | 'space';
  done: boolean;
  who: string;
  color: string;
};

const INITIAL_TASKS: Task[] = [
  { id: 1, title: 'Review Arbor Co homepage comps', space: 'Arbor Co', when: '10:00 AM', tag: 'client', done: false, who: 'LS', color: 'oklch(0.62 0.13 320)' },
  { id: 2, title: 'Sign off Q2 launch copy — brand voice', space: 'Q2 Launch', when: 'Due today', tag: 'ops', done: false, who: 'MH', color: 'oklch(0.58 0.12 60)' },
  { id: 3, title: 'Lumen partnership — draft MSA v3', space: 'Lumen', when: 'Due tomorrow', tag: 'client', done: false, who: 'NI', color: 'oklch(0.62 0.12 100)' },
  { id: 4, title: 'Pair with Dev on auth migration', space: 'Engineering', when: '2:30 PM', tag: 'eng', done: false, who: 'DK', color: 'oklch(0.6 0.13 150)' },
  { id: 5, title: 'Daily check-in', space: 'Team', when: 'Completed 09:02', tag: 'space', done: true, who: 'AM', color: 'oklch(0.6 0.12 30)' },
];

export default function DashboardHome() {
  const user = useAuthStore((s) => s.user);
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);

  const toggle = (id: number) => setTasks((t) => t.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));

  const { day, date, week, firstName } = useMemo(() => {
    const now = new Date();
    const d = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dt = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const start = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((now.getTime() - start.getTime()) / 86400000) + start.getDay() + 1) / 7);
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    const name = (user?.display_name || user?.email || 'there').split(/[@ ]/)[0];
    return { day: d, date: dt, week: `Week ${weekNum} · Q${quarter}`, firstName: name.charAt(0).toUpperCase() + name.slice(1) };
  }, [user]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  return (
    <div className="sh-view h-full overflow-y-auto">
      <div className="dash">
        {/* Hero */}
        <div className="dash-hero">
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>{greeting}, {firstName}</div>
            <h1 className="greeting">Three things matter <em>today.</em></h1>
            <div className="sub">You have 4 meetings, 3 client-facing tasks, and 2 threads awaiting your reply.</div>
          </div>
          <div className="date">
            {day.toUpperCase()}
            <span className="big">{date}</span>
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--sh-ink-4)' }}>{week}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="stat-row">
          <div className="stat">
            <div className="lbl">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 13V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" /><path d="M3 13h5l2 3h4l2-3h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
              Inbox
            </div>
            <div className="val">8<span className="tiny">unread</span></div>
            <div className="delta">↓ 12 from yesterday</div>
          </div>
          <div className="stat">
            <div className="lbl">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>
              Open tasks
            </div>
            <div className="val">14</div>
            <div className="delta">3 due today · 2 overdue</div>
          </div>
          <div className="stat">
            <div className="lbl">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
              Today
            </div>
            <div className="val">4<span className="tiny">meetings</span></div>
            <div className="delta">Next · 10:00 Arbor sync</div>
          </div>
          <div className="stat">
            <div className="lbl">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><circle cx="17" cy="7" r="3" /><path d="M22 18a5 5 0 0 0-7-4.6" /></svg>
              Clients active
            </div>
            <div className="val">6<span className="tiny">of 11</span></div>
            <div className="delta">Arbor, Lumen, Vega active</div>
          </div>
        </div>

        {/* Briefing */}
        <div className="card briefing" style={{ marginBottom: 28 }}>
          <div className="eyebrow"><span className="pulse" /> Your morning briefing · synthesized 08:52</div>
          <h2>
            Arbor Co approved the <mark>revised pricing page</mark>, but flagged accessibility concerns on the mobile flow.
            Leo is on it. The Q2 launch copy still needs your sign-off — Maya is blocked.
          </h2>
          <div className="chips">
            <div className="chip solid">Open Arbor thread →</div>
            <div className="chip">Review Q2 copy</div>
            <div className="chip">See 3 more updates</div>
          </div>
        </div>

        {/* Grid */}
        <div className="dash-grid">
          <div>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head">
                <h3>Today — focus list</h3>
                <span className="link">Reorder</span>
              </div>
              <div className="today-list">
                {tasks.map((t) => (
                  <div key={t.id} className="today-item" data-done={t.done} onClick={() => toggle(t.id)}>
                    <div className="checkbox" data-done={t.done} />
                    <div>
                      <div className="ti-title">{t.title}</div>
                      <div className="ti-meta">
                        <span className={`tag ${t.tag}`}>{t.space}</span>
                        <span>·</span>
                        <span>{t.when}</span>
                      </div>
                    </div>
                    <div className="ava" style={{ width: 22, height: 22, borderRadius: '50%', background: t.color, fontSize: 9.5 }}>{t.who}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3>Activity — last 24h</h3><span className="link">Open feed</span></div>
              <div className="feed">
                <div className="feed-item">
                  <div className="ava" style={{ background: 'oklch(0.62 0.13 20)' }}>EB</div>
                  <div>
                    <div className="body"><strong>Elena Boko</strong> <span className="subtle">shared a comment in</span> <strong>Arbor Co — Redesign</strong></div>
                    <div className="feed-quote">The revised pricing page works — can we ship it before Thursday? Our sales team is holding 4 demos on it.</div>
                    <div className="time">07:41 · 2h ago</div>
                  </div>
                </div>
                <div className="feed-item">
                  <div className="ava" style={{ background: 'oklch(0.6 0.13 150)' }}>DK</div>
                  <div>
                    <div className="body"><strong>Dev Krishnan</strong> <span className="subtle">moved</span> <strong>Auth migration — phase 2</strong> <span className="subtle">to</span> In Review</div>
                    <div className="time">06:12 · 4h ago</div>
                  </div>
                </div>
                <div className="feed-item">
                  <div className="ava" style={{ background: 'oklch(0.62 0.13 320)' }}>LS</div>
                  <div>
                    <div className="body"><strong>Leo Sato</strong> <span className="subtle">posted 6 comps in</span> #design-crit</div>
                    <div className="time">Yesterday · 18:20</div>
                  </div>
                </div>
                <div className="feed-item">
                  <div className="ava" style={{ background: 'oklch(0.58 0.12 60)' }}>MH</div>
                  <div>
                    <div className="body"><strong>Maya Hartwell</strong> <span className="subtle">is blocked on</span> <strong>Q2 launch copy</strong> <span className="subtle">— needs your sign-off</span></div>
                    <div className="time">Yesterday · 17:45</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-head"><h3>Standup — today</h3><span className="link">Post yours</span></div>
              <div className="standup">
                <div className="standup-person">
                  <div className="ava" style={{ background: 'oklch(0.62 0.13 260)' }}>PR</div>
                  <div>
                    <div className="meta"><span className="name">Priya Raman</span><span className="role">Engineering</span></div>
                    <div className="status-line"><b>Yesterday</b> — Shipped payments refactor. <b>Today</b> — Pair with Dev on auth. <b>Blockers</b> — None.</div>
                  </div>
                </div>
                <div className="standup-person">
                  <div className="ava" style={{ background: 'oklch(0.62 0.13 320)' }}>LS</div>
                  <div>
                    <div className="meta"><span className="name">Leo Sato</span><span className="role">Design</span></div>
                    <div className="status-line"><b>Today</b> — Arbor a11y fixes. Reviewing Tomás's motion studies at 3.</div>
                  </div>
                </div>
                <div className="standup-person">
                  <div className="ava" style={{ background: 'oklch(0.58 0.12 60)' }}>MH</div>
                  <div>
                    <div className="meta"><span className="name">Maya Hartwell</span><span className="role">Ops</span></div>
                    <div className="status-line"><b>Blocked</b> — Need sign-off on Q2 launch copy from Arjun.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3>Calendar</h3><span className="link">Open</span></div>
              <div>
                <div className="meet-row">
                  <div className="time-col"><span className="start">10:00</span><br />10:30</div>
                  <div className="bar" style={{ background: 'var(--sh-ink)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="title">Arbor Co — weekly sync</div>
                    <div className="sub-t">Elena, Leo, Maya · Google Meet</div>
                  </div>
                </div>
                <div className="meet-row">
                  <div className="time-col"><span className="start">11:30</span><br />12:00</div>
                  <div className="bar" style={{ background: 'oklch(0.6 0.12 260)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="title">1:1 — Priya</div>
                    <div className="sub-t">Recurring · Office</div>
                  </div>
                </div>
                <div className="meet-row">
                  <div className="time-col"><span className="start">14:30</span><br />15:00</div>
                  <div className="bar" style={{ background: 'oklch(0.6 0.12 150)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="title">Auth migration review</div>
                    <div className="sub-t">Dev, Priya · Engineering</div>
                  </div>
                </div>
                <div className="meet-row">
                  <div className="time-col"><span className="start">16:00</span><br />16:45</div>
                  <div className="bar" style={{ background: 'oklch(0.6 0.12 100)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="title">Lumen partnership — kickoff</div>
                    <div className="sub-t">Nina Ito · Lumen Studio</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
