import HomeHero from './HomeHero';
import HomeTimer from './HomeTimer';
import TodayList from './TodayList';
import DashboardStatRow from './DashboardStatRow';
import DashboardListPanel from './DashboardListPanel';
import NewTasksPanel from './NewTasksPanel';
import SecondaryCardRow from './SecondaryCardRow';

// The single home view shown to every non-client user (internal staff and
// partners alike). Clients/client-staff get ClientDashboard instead — see
// MainLayout. This replaces the old per-role home views.
//
// Layout: greeting with the work clock top-right, the five-card task strip,
// the type chips, then the lists. onOpenInbox is still passed by MainLayout,
// but the Inbox lives in the sidebar and rail now — kept in the signature so
// the caller doesn't churn.
export default function Home({ onOpenInbox: _onOpenInbox }: { onOpenInbox: () => void }) {
  return (
    <div className="sh-view hm-home h-full overflow-y-auto">
      <div className="hm-wrap">
        <HomeHero aside={<HomeTimer />} />
        <DashboardStatRow />
        {/* Bucket slide-overs opened from the strip — mounted here so the
            strip's entrance animation can't capture their fixed layer. */}
        <DashboardListPanel />
        <NewTasksPanel />
        <SecondaryCardRow />
        <TodayList />
      </div>
    </div>
  );
}
