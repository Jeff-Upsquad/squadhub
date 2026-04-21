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

  const loadingVal = '—';

  return (
    <>
      <div className="stat-row">
        <div className="stat" role="button" tabIndex={0} onClick={onOpenInbox} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenInbox(); } }}>
          <div className="lbl">
            <svg {...icoProps}><path d="M3 13V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" /><path d="M3 13h5l2 3h4l2-3h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            Inbox
          </div>
          <div className="val">{unreadLoading ? loadingVal : inboxCount}<span className="tiny">unread</span></div>
          <div className="delta">{inboxDelta}</div>
        </div>

        <div className="stat" role="button" tabIndex={0} onClick={() => setActiveDashboardTab('today')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDashboardTab('today'); } }}>
          <div className="lbl">
            <svg {...icoProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            Today
          </div>
          <div className="val">{tasksLoading ? loadingVal : todayCount}<span className="tiny">items</span></div>
          <div className="delta">{todayDelta}</div>
        </div>

        <div className="stat" role="button" tabIndex={0} onClick={() => setActiveDashboardTab('overdue')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDashboardTab('overdue'); } }}>
          <div className="lbl">
            <svg {...icoProps}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>
            Overdue
          </div>
          <div className="val">{tasksLoading ? loadingVal : overdueCount}</div>
          <div className="delta">{overdueDelta}</div>
        </div>

        <div className="stat" role="button" tabIndex={0} onClick={() => setActiveDashboardTab('tomorrow')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDashboardTab('tomorrow'); } }}>
          <div className="lbl">
            <svg {...icoProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            Tomorrow
          </div>
          <div className="val">{tasksLoading ? loadingVal : tomorrowCount}<span className="tiny">items</span></div>
          <div className="delta">{tomorrowDelta}</div>
        </div>
      </div>

      <DashboardListPanel />
    </>
  );
}
