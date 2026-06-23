import type { SpaceStatus, StatusCategory } from '@squadhub/shared';
import { getTaskStatusDef } from '@squadhub/shared';
import type { RequestStatus } from '../views/app/pm/client-design/atoms/StatusPill';

/**
 * Maps a list name to the design-space status lane it backs, or null if the
 * list is not one of the template-seeded status lists.
 *
 * Design Spaces (template-based folders) are seeded with backing lists — Briefs,
 * In Progress, Reviews, Completed — whose tasks the ClientDesignDashboard
 * aggregates into views (Requests / Board / Reports / Completed). These lists
 * are plumbing for those views, not lists the user manually created, so they
 * are hidden from the sidebar tree (see `isDesignStatusListName`).
 */
export function listNameToStatus(name: string): RequestStatus | null {
  const n = name.trim().toLowerCase();
  if (n === 'briefs' || n === 'queued' || n === 'queue') return 'queued';
  if (n === 'in progress' || n === 'in-progress' || n === 'progress') return 'progress';
  if (n === 'reviews' || n === 'review' || n === 'in review') return 'review';
  if (n === 'completed' || n === 'done') return 'done';
  return null;
}

/**
 * True when a list name is one of the template-seeded design-space status lists.
 * Such lists surface only as views inside the Design Space page, not as
 * standalone children in the sidebar tree.
 */
export function isDesignStatusListName(name: string): boolean {
  return listNameToStatus(name) !== null;
}

/**
 * Order a space's statuses by their template position so columns/groups render
 * New Request → … → Closed regardless of the order the API returns them in.
 */
export function sortStages(statuses: SpaceStatus[]): SpaceStatus[] {
  return [...statuses].sort((a, b) => a.position - b.position);
}

/**
 * Resolve a task's raw `status` string to the design/video-space stage it
 * belongs to. Mirrors the resolution + legacy-normalization the task drawer
 * already does (see TaskDetailPanel `status`/normalization effect):
 *   1. exact stage name ("Work in Progress")
 *   2. a bare StatusCategory string ('todo'|'active'|'done'|'closed')
 *   3. a TASK_STATUS_CATALOG key (e.g. 'in_progress') → its category → first
 *      stage of that category
 *   4. fallback to the default stage (or the first one)
 * Returns null only when the space has no statuses yet.
 */
export function resolveStage(
  taskStatus: string | null | undefined,
  statuses: SpaceStatus[],
): SpaceStatus | null {
  if (!statuses.length) return null;
  if (taskStatus) {
    const byName = statuses.find((s) => s.name === taskStatus);
    if (byName) return byName;
    const byCategory = statuses.find((s) => s.category === taskStatus);
    if (byCategory) return byCategory;
    const catalogCat = getTaskStatusDef(taskStatus)?.category;
    if (catalogCat) {
      const byCatalog = statuses.find((s) => s.category === catalogCat);
      if (byCatalog) return byCatalog;
    }
  }
  return statuses.find((s) => s.is_default) || statuses[0] || null;
}

/**
 * Collapse a stage's fine-grained category into the legacy 4-bucket
 * RequestStatus used by the coarse KPI/report rollups.
 */
export function stageCategoryToBucket(category: StatusCategory): RequestStatus {
  switch (category) {
    case 'todo':
      return 'queued';
    case 'active':
      return 'progress';
    case 'done':
      return 'review';
    case 'closed':
      return 'done';
    default:
      return 'queued';
  }
}
