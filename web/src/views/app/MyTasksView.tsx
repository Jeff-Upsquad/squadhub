import { usePersonalList, useTasks } from '../../hooks/useTasks';
import { useIsMobile } from '../../hooks/useIsMobile';
import { isTaskCompleted } from '../../lib/taskGrouping';
import ListPage from './pm/ListPage';

/**
 * "My Tasks" — the user's PRIVATE personal workspace. Backed by a per-user
 * private space + list (GET /pm/personal, get-or-create), which is hidden from
 * the normal Spaces sidebar so only the owner ever sees it. Renders the standard
 * list/board UI (via ListPage, embedded) so the user gets full create / plan /
 * group / filter for their personal to-dos. The desktop ⌘⇧T quick-add captures
 * straight into this same list.
 *
 * On the phone this mirrors the Partner app's TasksScreen.kt header: large
 * title over an "N open · your work" line, sitting under a back-only app bar.
 */
export default function MyTasksView() {
  const { data, isLoading, isError, refetch } = usePersonalList();
  const isMobile = useIsMobile();
  // Same query/cache key ListPage uses below, so this costs nothing extra.
  const { data: tasks } = useTasks(isMobile && data ? data.list.id : null, undefined);
  const openCount = tasks ? tasks.filter((t) => !isTaskCompleted(t)).length : null;

  return (
    <div className="sh-view flex h-full min-h-0 flex-col">
      {/* Private hero — desktop only; the phone gets the app-style header. */}
      {!isMobile && (
        <div className="mtk-private-head" style={{ padding: '14px 16px 10px', flexShrink: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '.04em',
              textTransform: 'uppercase',
              color: 'var(--sh-ink-4)',
            }}
          >
            My Tasks · Private
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sh-ink-1, inherit)', marginTop: 2 }}>
            Your personal tasks
          </div>
          <div style={{ fontSize: 12, color: 'var(--sh-ink-3)', marginTop: 2 }}>
            🔒 Only you can see these. Capture from anywhere with ⌘⇧T on desktop.
          </div>
        </div>
      )}

      {isMobile && (
        <div className="mtk-phone-head">
          <h1>My Tasks</h1>
          <p>{openCount === null ? 'Your work' : `${openCount} open · your work`}</p>
        </div>
      )}

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
