import type { ReactNode } from 'react';
import type { Task } from '@squadhub/shared';
import type { GroupedRow } from '../../../lib/taskGrouping';
import { usePMStore } from '../../../stores/pmStore';
import {
  DND_GROUP_CONTAINER_ID,
  DND_GROUP_CONTAINER_TYPE,
  DND_GROUP_CONTAINER_NAME,
  DND_GROUP_ESTIMATE_TOTAL,
} from '../calendar/calendarUtils';

// A single collapsed "Grouped tasks under {name}" row on Home. Renders like a
// task row (so it sits naturally in a .hm-list). Three affordances:
//   - the chevron toggles the inline child task list,
//   - the group icon opens the underlying container in PM (onOpenContainer),
//   - clicking the name/row opens the work-block-style group detail panel,
//     where you can run a focus session on the whole group.
//
// Generic over `renderChild` so both Home surfaces reuse it: the Focus list
// passes <TodayRow>, the dashboard panel passes <DashboardTaskRow>.
export default function GroupedTaskRow({
  row,
  expanded,
  onToggle,
  onOpenContainer,
  renderChild,
  draggable = false,
}: {
  row: GroupedRow;
  expanded: boolean;
  onToggle: () => void;
  onOpenContainer?: (container: GroupedRow['container']) => void;
  renderChild: (task: Task) => ReactNode;
  // When true (Day Planner), the collapsed header is draggable onto the
  // calendar, where it becomes ONE combined block sized to the summed estimate.
  draggable?: boolean;
}) {
  const setGroupRunPanel = usePMStore((s) => s.setGroupRunPanel);

  const openPanel = () => {
    setGroupRunPanel({
      key: `group-container:${row.container.type}:${row.container.id}`,
      label: `Grouped tasks under ${row.container.name}`,
      listId: row.container.type === 'list' ? row.container.id : null,
      tasks: row.tasks.map((t) => ({ id: t.id, title: t.title })),
    });
  };

  return (
    <>
      <div
        className="hm-task hm-grouped"
        data-expanded={expanded || undefined}
        draggable={draggable || undefined}
        onDragStart={
          draggable
            ? (e) => {
                const total = row.tasks.reduce((s, t) => s + (t.time_estimate ?? 30), 0);
                e.dataTransfer.setData(DND_GROUP_CONTAINER_ID, row.container.id);
                e.dataTransfer.setData(DND_GROUP_CONTAINER_TYPE, row.container.type);
                e.dataTransfer.setData(DND_GROUP_CONTAINER_NAME, row.container.name);
                e.dataTransfer.setData(DND_GROUP_ESTIMATE_TOTAL, String(total));
                e.dataTransfer.effectAllowed = 'copyMove';
              }
            : undefined
        }
        onClick={openPanel}
        role="button"
        tabIndex={0}
        aria-label={`Open ${row.container.name} group session`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(); }
        }}
      >
        <span
          className="hm-grouped-chevron"
          data-expanded={expanded || undefined}
          role="button"
          tabIndex={0}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          title={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggle(); }
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
        <span
          className="hm-grouped-icon"
          role={onOpenContainer ? 'button' : undefined}
          tabIndex={onOpenContainer ? 0 : undefined}
          aria-hidden={onOpenContainer ? undefined : 'true'}
          aria-label={onOpenContainer ? `Open ${row.container.name}` : undefined}
          title={onOpenContainer ? `Open ${row.container.name}` : undefined}
          onClick={(e) => {
            if (!onOpenContainer) return;
            e.stopPropagation();
            onOpenContainer(row.container);
          }}
          onKeyDown={(e) => {
            if (!onOpenContainer) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenContainer(row.container); }
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m12 2 9 4.5-9 4.5-9-4.5L12 2Z" />
            <path d="m3 12 9 4.5 9-4.5" />
            <path d="m3 17 9 4.5 9-4.5" />
          </svg>
        </span>
        <div className="t">
          <span className="title hm-grouped-title">
            Grouped tasks under {row.container.name}
          </span>
        </div>
        <span className="hm-count">· {row.count}</span>
      </div>
      {expanded && (
        <div className="hm-list hm-grouped-children" style={{ paddingTop: 0 }}>
          {row.tasks.map((t) => renderChild(t))}
        </div>
      )}
    </>
  );
}
