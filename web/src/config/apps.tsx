import type { HomeView } from '../layouts/MainLayout';
import { getFreshAccessToken } from '../services/api';

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
  /** Link-out apps that need a special launch handler instead of a view. */
  external?: 'squadbooks';
  /** SVG path `d` values — outline icons drawn on a 24×24 viewBox. */
  paths: string[];
}

// Render order for category groups in the Apps module. Apps whose category is
// not listed here fall to the end (see AppsView).
export const APP_CATEGORY_ORDER = ['Daily', 'Productivity', 'Sales', 'Hiring', 'Finance'] as const;

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
    description: 'Manage team check-ins, deadlines, office timing & holidays.',
    view: 'check-ins',
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
    slug: 'squad-clips',
    name: 'Squad Clips',
    category: 'Productivity',
    description: 'Record and share quick clips.',
    view: 'clips',
    paths: [
      'M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z',
    ],
  },
  {
    slug: 'sales-leads',
    name: 'Sales Leads',
    category: 'Sales',
    description: 'Manage your sales pipeline.',
    view: 'sales-leads',
    paths: ['M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z'],
  },
  {
    slug: 'candidates',
    name: 'Candidates',
    category: 'Hiring',
    description: 'Review and manage recruiting candidates.',
    view: 'candidates',
    paths: [
      'M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z',
    ],
  },
  {
    slug: 'cash-book',
    name: 'Cash Book',
    category: 'Finance',
    description: 'Track cash in and out.',
    view: 'cashbook',
    paths: [
      'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z',
    ],
  },
  {
    slug: 'squadbooks',
    name: 'SquadBooks',
    category: 'Finance',
    description: 'Full accounting in SquadBooks.',
    external: 'squadbooks',
    paths: [
      'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    ],
  },
];

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
// SquadBooks is a sibling app (own subdomain + DB). Launch = link-out with an
// SSO handoff token, mirroring how Squad Clips hands off its session.
export const SQUADBOOKS_URL =
  process.env.NEXT_PUBLIC_SQUADBOOKS_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://books.squadhub.in' : 'http://localhost:3300');

async function launchSquadBooks(workspace: { id: string; name: string } | null | undefined) {
  const token = await getFreshAccessToken();
  if (!token || !workspace) return;
  const url = `${SQUADBOOKS_URL}/sso#t=${encodeURIComponent(token)}&w=${encodeURIComponent(
    workspace.id,
  )}&wn=${encodeURIComponent(workspace.name)}`;
  window.open(url, '_blank', 'noopener');
}

/**
 * Open an app — internal views navigate via `openView`, link-out apps hand off
 * with an SSO token. Hosts supply how to navigate so the same call works from
 * the Apps module and the sidebar.
 */
export async function launchApp(
  app: AppDef,
  opts: { workspace?: { id: string; name: string } | null; openView: (view: HomeView) => void },
): Promise<void> {
  if (app.external === 'squadbooks') {
    await launchSquadBooks(opts.workspace);
    return;
  }
  if (app.view) opts.openView(app.view);
}
