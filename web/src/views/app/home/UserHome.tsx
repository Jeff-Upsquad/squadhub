import { useMemo } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { getDailyQuote } from '../../../lib/dailyQuote';
import TodayList from './TodayList';
import DashboardStatRow from './DashboardStatRow';

export default function UserHome({ onOpenInbox }: { onOpenInbox: () => void }) {
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

  const quote = useMemo(() => getDailyQuote(), []);

  return (
    <div className="sh-view h-full overflow-y-auto">
      <div className="dash">
        <div className="dash-hero">
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Welcome back, {firstName}</div>
            <h1 className="greeting">Three items need <em>your eye today.</em></h1>
            <div className="sub">{quote}</div>
          </div>
          <div className="date">
            {day.toUpperCase()}
            <span className="big">{date}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--sh-ink-4)' }}>{week}</span>
          </div>
        </div>

        <DashboardStatRow onOpenInbox={onOpenInbox} />

        <TodayList />
      </div>
    </div>
  );
}
