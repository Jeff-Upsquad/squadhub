import { usePersonalList } from '../../hooks/useTasks';
import { useIsMobile } from '../../hooks/useIsMobile';
import { usePMStore } from '../../stores/pmStore';
import ListPage from './pm/ListPage';
import MobileMyTasks from '../../mobile/MobileMyTasks';
import MobileBucket from '../../mobile/MobileBucket';

/**
 * "My Tasks" — desktop is the private personal list; the phone is the Partner
 * app's TasksScreen (assigned work, bucketed), not a squeezed ListPage.
 * Home tiles open BucketScreen (Today / Overdue / …) via activeDashboardTab.
 */
export default function MyTasksView() {
  const { data, isLoading, isError, refetch } = usePersonalList();
  const isMobile = useIsMobile();
  const dashboardTab = usePMStore((s) => s.activeDashboardTab);

  if (isMobile) return dashboardTab ? <MobileBucket /> : <MobileMyTasks />;

  return (
    <div className="sh-view flex h-full min-h-0 flex-col">
      {isLoading && (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--sh-ink-3)]">
          Loading your personal space…
        </div>
      )}

      {isError && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-[var(--sh-ink-3)]">
          <p>Couldn’t load your personal tasks.</p>
          <button className="lv-newtask-btn" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}

      {data && <ListPage listId={data.list.id} spaceId={data.space.id} embedded />}
    </div>
  );
}
