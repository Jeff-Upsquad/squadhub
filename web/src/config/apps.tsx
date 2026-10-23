import type { HomeView } from '../layouts/MainLayout';
import { markAppOpened } from '../stores/recentOpensStore';

// ---- App registry ----
// Single source of truth for the in-app "Apps" (mini-apps). Both the Apps
// module page and the sidebar's Apps section render from this list. Visibility
// is gated per-user by the mini-app `slug` (see useAvailableApps), matching the
// access the old hardcoded sidebar buttons used.

export interface AppDef {
  /** Mini-app slug — gates visibility (useHasMiniApp) and keys favourites. */
  slug: string;
  /** Display name. */
  name: string;
  /** Category used to group apps in the Apps module. */
  category: string;
  /** One-line description shown in the Apps module. */
  description: string;
  /** Internal SPA view the app opens (omitted for link-out apps). */
  view?: HomeView;
  /** Link-out apps that need a special launch handler instead of a view (none in the SaaS). */
  external?: never;
  /** SVG path `d` values — outline icons drawn on a 24×24 viewBox. */
  paths: string[];
}

// Render order for category groups in the Apps module. Apps whose category is
// not listed here fall to the end (see AppsView).
export const APP_CATEGORY_ORDER = ['Daily', 'Productivity', 'Finance'] as const;

export const APPS: AppDef[] = [
  {
    slug: 'daily-checkin',
    name: 'Daily Check-In',
    category: 'Daily',
    description: 'Log your team’s daily check-ins.',
    view: 'checkin',
    paths: ['M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'],
  },
  {
    slug: 'daily-checkin-partners',
    name: 'Daily Check-In (Partners)',
    category: 'Daily',
    description: 'Daily check-ins for partners.',
    view: 'checkin-partners',
    paths: ['M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'],
  },
  {
    slug: 'check-ins',
    name: 'Check-Ins',
    category: 'Daily',
    description: 'Daily check-ins and time tracking for this account.',
    view: 'checkin',
    paths: [
      'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2',
      'M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
      'M9 14l2 2 4-4',
    ],
  },
  {
    slug: 'time-management',
    name: 'Time Management',
    category: 'Productivity',
    description: 'Track time across your work.',
    view: 'time-management',
    paths: ['M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z'],
  },
  {
    slug: 'meetings',
    name: 'Meetings',
    category: 'Productivity',
    description: 'Schedule meetings & events with availability voting.',
    view: 'meetings',
    paths: [
      'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    ],
  },
  {
    slug: 'partner-payments',
    name: 'Partner Payments',
    category: 'Finance',
    description: 'Assigned clients, monthly payouts & commission status.',
    view: 'partner-payments',
    paths: [
      'M2 9a2 2 0 012-2h16a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V9z',
      'M16 5.5h2a2 2 0 012 2v1.5m0 7V17a2 2 0 01-2 2h-2M8 19H6a2 2 0 01-2-2v-1.5M4 8.5V7a2 2 0 012-2h2',
      'M12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
      'M6.5 12h.01M17.5 12h.01',
    ],
  },];

// ---- Icon renderer ----
export function AppIcon({ paths, className }: { paths: string[]; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

// ---- Launching ----
/**
 * Open an app — internal views navigate via `openView`, link-out apps hand off
 * with an SSO token. Hosts supply how to navigate so the same call works from
 * the Apps module and the sidebar.
 */
export async function launchApp(
  app: AppDef,
  opts: { workspace?: { id: string; name: string } | null; openView: (view: HomeView) => void },
): Promise<void> {
  markAppOpened(app.slug);
  if (app.view) opts.openView(app.view);
}
