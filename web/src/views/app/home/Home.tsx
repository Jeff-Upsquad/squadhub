import HomeHero from './HomeHero';
import HomeTimer from './HomeTimer';
import TodayList from './TodayList';
import DashboardStatRow from './DashboardStatRow';

// The single home view shown to every non-client user (internal staff and
// partners alike). Clients/client-staff get ClientDashboard instead — see
// MainLayout. This replaces the old per-role home views.
export default function Home({ onOpenInbox }: { onOpenInbox: () => void }) {
  return (
    <div className="sh-view hm-home h-full overflow-y-auto">
      <div className="hm-wrap">
        <HomeHero aside={<HomeTimer />} />
        <DashboardStatRow onOpenInbox={onOpenInbox} />
        <TodayList />
      </div>
    </div>
  );
}
