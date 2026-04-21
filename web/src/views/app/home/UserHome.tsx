import { useMemo } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import TodayList from './TodayList';

const icoProps = {
  width: 12, height: 12, fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};

export default function UserHome() {
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

  return (
    <div className="sh-view h-full overflow-y-auto">
      <div className="dash">
        <div className="dash-hero">
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Welcome back, {firstName}</div>
            <h1 className="greeting">Three items need <em>your eye today.</em></h1>
            <div className="sub">Your squad shipped 2 things yesterday. Nothing is blocking you right now — but three approvals are waiting.</div>
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
            <div className="val">5<span className="tiny">unread</span></div>
            <div className="delta">2 from your squad</div>
          </div>
          <div className="stat">
            <div className="lbl">
              <svg {...icoProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
              Today
            </div>
            <div className="val">3<span className="tiny">items</span></div>
            <div className="delta">1 approval · 2 reviews</div>
          </div>
          <div className="stat">
            <div className="lbl">
              <svg {...icoProps}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>
              Overdue
            </div>
            <div className="val">1</div>
            <div className="delta">Q2 launch copy sign-off</div>
          </div>
          <div className="stat">
            <div className="lbl">
              <svg {...icoProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
              Tomorrow
            </div>
            <div className="val">4<span className="tiny">items</span></div>
            <div className="delta">2 meetings · 2 approvals</div>
          </div>
        </div>

        <TodayList />
      </div>
    </div>
  );
}
