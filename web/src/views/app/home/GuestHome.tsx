import { useMemo } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import TodayList from './TodayList';

const icoProps = {
  width: 12, height: 12, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};

export default function GuestHome() {
  const user = useAuthStore((s) => s.user);

  const { day, date, week, firstName } = useMemo(() => {
    const now = new Date();
    const d = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dt = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const start = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((now.getTime() - start.getTime()) / 86400000) + start.getDay() + 1) / 7);
    const name = (user?.display_name || user?.email || 'there').split(/[@ ]/)[0];
    return { day: d, date: dt, week: `Week ${weekNum}`, firstName: name.charAt(0).toUpperCase() + name.slice(1) };
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
        <div className="dash-hero">
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>{greeting}, {firstName}</div>
            <h1 className="greeting">Today is<br /><em>4 focused hours.</em></h1>
            <div className="sub">Two clients have work for you today. You're tracking toward your 28-hour target this week.</div>
          </div>
          <div className="date">
            {day.toUpperCase()}
            <span className="big">{date}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--sh-ink-4)' }}>{week}</span>
          </div>
        </div>

        <div className="stat-row">
          <div className="stat">
            <div className="lbl">
              <svg {...icoProps}><path d="M3 13V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" /><path d="M3 13h5l2 3h4l2-3h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
              Inbox
            </div>
            <div className="val">3<span className="tiny">unread</span></div>
            <div className="delta">2 from Arbor</div>
          </div>
          <div className="stat">
            <div className="lbl">
              <svg {...icoProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
              Today
            </div>
            <div className="val">4<span className="tiny">items</span></div>
            <div className="delta">2 meetings · 2 tasks</div>
          </div>
          <div className="stat">
            <div className="lbl">
              <svg {...icoProps}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>
              Overdue
            </div>
            <div className="val">0</div>
            <div className="delta">All clear</div>
          </div>
          <div className="stat">
            <div className="lbl">
              <svg {...icoProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
              Tomorrow
            </div>
            <div className="val">3<span className="tiny">items</span></div>
            <div className="delta">Lumen animations · Vega logo</div>
          </div>
        </div>

        <TodayList />
      </div>
    </div>
  );
}
