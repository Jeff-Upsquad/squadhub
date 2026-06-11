import HomeHero from './HomeHero';
import TodayList from './TodayList';
import DashboardStatRow from './DashboardStatRow';

export default function VideoEditorHome({ onOpenInbox }: { onOpenInbox: () => void }) {
  return (
    <div className="sh-view hm-home h-full overflow-y-auto">
      <div className="hm-wrap">
        <HomeHero roleLabel="Video Editor Home" greetingPrefix="Lights, camera" />
        <DashboardStatRow onOpenInbox={onOpenInbox} />
        <TodayList />
      </div>
    </div>
  );
}
