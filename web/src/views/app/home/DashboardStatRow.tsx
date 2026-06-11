import { useMyTasksSummary } from '../../../hooks/useMyTasksSummary';
import { useUnreadCount } from '../../../hooks/useUnreadCount';
import { usePMStore } from '../../../stores/pmStore';
import DashboardListPanel from './DashboardListPanel';

const icoProps = {
  width: 12,
  height: 12,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};

// ↗ affordance revealed on hover — the stats are doors, not just numbers
const GoArrow = () => (
  <svg className="go" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17 17 7M7 7h10v10" />
  </svg>
);

function truncate(s: string, n = 32) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function DashboardStatRow({ onOpenInbox }: { onOpenInbox: () => void }) {
  const setActiveDashboardTab = usePMStore((s) => s.setActiveDashboardTab);
  const { data: buckets, isLoading: tasksLoading } = useMyTasksSummary();
  const { data: unread, isLoading: unreadLoading } = useUnreadCount();

  const inboxCount = unread ?? 0;
  const todayCount = buckets?.today.length ?? 0;
  const overdueCount = buckets?.overdue.length ?? 0;
  const tomorrowCount = buckets?.tomorrow.length ?? 0;
  const allTasks = buckets
    ? [...buckets.overdue, ...buckets.today, ...buckets.tomorrow, ...buckets.upcoming, ...buckets.later]
    : [];
  const allCount = allTasks.length;

  const inboxDelta = unreadLoading
    ? ''
    : inboxCount === 0
      ? 'All caught up'
      : `${inboxCount} unread`;

  const todayDelta = tasksLoading
    ? ''
    : todayCount === 0
      ? 'Nothing on your plate'
      : buckets?.today[0]?.title
        ? truncate(buckets.today[0].title, 34)
        : `${todayCount} items`;

  const overdueDelta = tasksLoading
    ? ''
    : overdueCount === 0
      ? 'All clear'
      : buckets?.overdue[0]?.title
        ? truncate(buckets.overdue[0].title, 34)
        : `${overdueCount} items`;

  const tomorrowDelta = tasksLoading
    ? ''
    : tomorrowCount === 0
      ? 'Wide open'
      : buckets?.tomorrow[0]?.title
        ? truncate(buckets.tomorrow[0].title, 34)
        : `${tomorrowCount} items`;

  const allDelta = tasksLoading
    ? ''
    : allCount === 0
      ? 'Nothing assigned'
      : allTasks[0]?.title
        ? truncate(allTasks[0].title, 34)
        : `${allCount} items`;

  const loadingVal = '—';

  return (
    <>
      <div className="hm-stats">
        <div
          className="hm-stat"
          role="button"
          tabIndex={0}
          onClick={onOpenInbox}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenInbox(); } }}
        >
          <div className="lbl">
            <svg {...icoProps}><path d="M3 13V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" /><path d="M3 13h5l2 3h4l2-3h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            Inbox
            {inboxCount > 0 && <span className="ping" />}
          </div>
          <div className="val">{unreadLoading ? loadingVal : inboxCount}<span className="unit">unread</span></div>
          <div className="sub">{inboxDelta}</div>
          <GoArrow />
        </div>

        <div
          className="hm-stat"
          role="button"
          tabIndex={0}
          onClick={() => setActiveDashboardTab('today')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDashboardTab('today'); } }}
        >
          <div className="lbl">
            <svg {...icoProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            Today
          </div>
          <div className="val">{tasksLoading ? loadingVal : todayCount}<span className="unit">items</span></div>
          <div className="sub">{todayDelta}</div>
          <GoArrow />
        </div>

        <div
          className="hm-stat"
          data-alert={!tasksLoading && overdueCount > 0}
          role="button"
          tabIndex={0}
          onClick={() => setActiveDashboardTab('overdue')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDashboardTab('overdue'); } }}
        >
          <div className="lbl">
            <svg {...icoProps}><circle cx="12" cy="13" r="8" /><path d="M12 9.5v4l2.5 2" /><path d="M5 3 3 5M19 3l2 2" /></svg>
            Overdue
          </div>
          <div className="val">{tasksLoading ? loadingVal : overdueCount}</div>
          <div className="sub">{overdueDelta}</div>
          <GoArrow />
        </div>

        <div
          className="hm-stat"
          role="button"
          tabIndex={0}
          onClick={() => setActiveDashboardTab('tomorrow')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDashboardTab('tomorrow'); } }}
        >
          <div className="lbl">
            <svg {...icoProps}><path d="M17 18a5 5 0 0 0-10 0" /><path d="M12 9V3M4.9 10.9l1.4 1.4M2 18h2M20 18h2M17.7 12.3l1.4-1.4" /><path d="M4 22h16" /></svg>
            Tomorrow
          </div>
          <div className="val">{tasksLoading ? loadingVal : tomorrowCount}<span className="unit">items</span></div>
          <div className="sub">{tomorrowDelta}</div>
          <GoArrow />
        </div>

        <div
          className="hm-stat"
          role="button"
          tabIndex={0}
          onClick={() => setActiveDashboardTab('all')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDashboardTab('all'); } }}
        >
          <div className="lbl">
            <svg {...icoProps}><path d="M4 6h16M4 12h16M4 18h10" /></svg>
            All tasks
          </div>
          <div className="val">{tasksLoading ? loadingVal : allCount}<span className="unit">items</span></div>
          <div className="sub">{allDelta}</div>
          <GoArrow />
        </div>
      </div>

      <DashboardListPanel />
    </>
  );
}
