import { usePersonalList } from '../../hooks/useTasks';
import ListPage from './pm/ListPage';

/**
 * "My Tasks" — the user's PRIVATE personal workspace. Backed by a per-user
 * private space + list (GET /pm/personal, get-or-create), which is hidden from
 * the normal Spaces sidebar so only the owner ever sees it. Renders the standard
 * list/board UI (via ListPage, embedded) so the user gets full create / plan /
 * group / filter for their personal to-dos. The desktop ⌘⇧T quick-add captures
 * straight into this same list.
 */
export default function MyTasksView() {
  const { data, isLoading, isError, refetch } = usePersonalList();

  return (
    <div className="sh-view flex h-full min-h-0 flex-col">
      {/* Private header — the host header for the embedded ListPage below */}
      <div style={{ padding: '14px 16px 10px', flexShrink: 0 }}>
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
