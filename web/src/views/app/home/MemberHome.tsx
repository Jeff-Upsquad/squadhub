import HomeHero from './HomeHero';
import TodayList from './TodayList';
import DashboardStatRow from './DashboardStatRow';

export default function MemberHome({ onOpenInbox }: { onOpenInbox: () => void }) {
  return (
    <div className="sh-view hm-home h-full overflow-y-auto">
      <div className="hm-wrap">
        <HomeHero roleLabel="Member Home" />
        <DashboardStatRow onOpenInbox={onOpenInbox} />
        <TodayList />
      </div>
    </div>
  );
}
