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
