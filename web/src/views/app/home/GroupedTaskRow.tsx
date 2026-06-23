import type { ReactNode } from 'react';
import type { Task } from '@squadhub/shared';
import type { GroupedRow } from '../../../lib/taskGrouping';

// A single collapsed "Grouped tasks under {name}" row on Home. Renders like a
// task row (so it sits naturally in a .hm-list) with a chevron that expands the
// child task rows inline. The title opens the underlying container in PM.
//
// Generic over `renderChild` so both Home surfaces reuse it: the Focus list
// passes <TodayRow>, the dashboard panel passes <DashboardTaskRow>.
export default function GroupedTaskRow({
  row,
  expanded,
  onToggle,
  onOpenContainer,
  renderChild,
}: {
  row: GroupedRow;
  expanded: boolean;
  onToggle: () => void;
  onOpenContainer?: (container: GroupedRow['container']) => void;
  renderChild: (task: Task) => ReactNode;
}) {
  return (
    <>
      <div
        className="hm-task hm-grouped"
        data-expanded={expanded || undefined}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
        }}
      >
        <span className="hm-grouped-chevron" data-expanded={expanded || undefined} aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
        <span className="hm-grouped-icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 2 9 4.5-9 4.5-9-4.5L12 2Z" />
            <path d="m3 12 9 4.5 9-4.5" />
            <path d="m3 17 9 4.5 9-4.5" />
          </svg>
        </span>
        <div className="t">
          <span
            className="title hm-grouped-title"
            role={onOpenContainer ? 'link' : undefined}
            tabIndex={onOpenContainer ? 0 : undefined}
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
