'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '../stores/authStore';
import ThemeToggle from '../components/ThemeToggle';

const MAIN_APP_URL = process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === 'production' ? '/' : 'http://localhost:3000');

function NavLink({ href, end, children }: { href: string; end?: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = end ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
        isActive ? 'bg-surface-alt text-foreground font-medium' : 'text-foreground-muted hover:bg-surface-alt hover:text-foreground'
      }`}
    >
      {children}
    </Link>
  );
}

export default function WorkspaceAdminLayout({ children }: { children: React.ReactNode }) {
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="flex min-h-screen bg-surface text-foreground">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-divider bg-surface">
        <div className="flex items-center gap-2 border-b border-divider px-5 py-4">
          <h1 className="font-[family-name:var(--font-display)] text-lg font-bold text-foreground">Workspace</h1>
          <span className="font-[family-name:var(--font-mono)] rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-foreground-muted">Settings</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          <NavLink href="/admin/workspace-admin" end>
            Settings
          </NavLink>
          <NavLink href="/admin/workspace-admin/members">
            Members
          </NavLink>

          <div className="!mt-4 border-t border-divider pt-3">
            <NavLink href="/admin">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Platform Admin
            </NavLink>
          </div>
        </nav>
        <div className="border-t border-divider p-3 space-y-0.5">
          <div className="px-1 pb-2">
            <ThemeToggle />
          </div>
          <a
            href={MAIN_APP_URL}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground-muted hover:bg-surface-alt hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to App
          </a>
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground-muted hover:bg-surface-alt hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Content area */}
      <main className="flex-1 overflow-y-auto bg-canvas p-6">
        {children}
      </main>
    </div>
  );
}
