import type { ReactNode } from 'react';
import type { Task } from '@squadhub/shared';
import { isTaskCompleted } from '../../../lib/taskGrouping';
import { matchesOverviewTile, OVERVIEW_TILES, taskOverviewSummary, type OverviewTile } from '../../../lib/taskOverviewTiles';
import './task-overview.css';

/** Shared header for the design's Area, Folder and List views. */
export default function TaskOverviewHeader({
  title, tasks, timeZone, scopeLabel, loading, query, onQueryChange,
  tile, onTileChange, onCreate, actions, breadcrumbs, children,
}: {
  title: string;
  tasks: Task[];
  timeZone: string;
  scopeLabel?: string;
  loading?: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  tile: OverviewTile;
  onTileChange: (tile: OverviewTile) => void;
  onCreate?: () => void;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  children?: ReactNode;
}) {
  const open = tasks.filter((t) => !isTaskCompleted(t));
  const now = new Date();
  return (
    <section className="tov-card tov-head" aria-label={`${title} overview`}>
      {breadcrumbs}
      <div className="tov-head-row">
        <div className="tov-title-wrap">
          <h1 className="tov-title">{title}<span className="tov-title-dot">.</span></h1>
          <p className="tov-summary">{loading && tasks.length === 0 ? 'Loading tasks…' : taskOverviewSummary(tasks, timeZone, scopeLabel, now)}</p>
        </div>
        <div className="tov-head-actions">
          <label className="tov-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={(e) => onQueryChange(e.target.value)} />
          </label>
          {onCreate && <button type="button" className="tov-new" onClick={onCreate}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            New task
          </button>}
          {actions}
        </div>
      </div>
      <div className="tov-tiles" role="group" aria-label="Task shortcuts">
        {OVERVIEW_TILES.map((x) => (
          <button key={x.key} type="button" className="tov-tile" data-on={tile === x.key || undefined}
            aria-pressed={tile === x.key} onClick={() => onTileChange(tile === x.key ? 'all' : x.key)}>
            <span className="tov-tile-top">
              <span className="tov-dot" style={{ background: x.dot }} />
              <span className="tov-tile-name">{x.name}</span>
            </span>
            <span className="tov-tile-num">{open.filter((t) => matchesOverviewTile(t, x.key, timeZone, now)).length}</span>
          </button>
        ))}
      </div>
      {children}
    </section>
  );
}
