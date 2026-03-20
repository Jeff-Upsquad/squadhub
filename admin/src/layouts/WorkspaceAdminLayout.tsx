import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

const MAIN_APP_URL = import.meta.env.VITE_APP_URL || (import.meta.env.PROD ? '/' : 'http://localhost:5173');

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
    isActive ? 'bg-[#F8FAFC] text-[#0F172B] font-medium' : 'text-[#62748E] hover:bg-[#F8FAFC] hover:text-[#0F172B]'
  }`;

export default function WorkspaceAdminLayout() {
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="flex min-h-screen bg-white text-[#0F172B]">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-[#E2E8F0] bg-white">
        <div className="flex items-center gap-2 border-b border-[#E2E8F0] px-5 py-4">
          <h1 className="font-[family-name:var(--font-display)] text-lg font-bold text-[#0F172B]">Workspace</h1>
          <span className="font-[family-name:var(--font-mono)] rounded-full bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">Settings</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          <NavLink to="/workspace-admin" end className={navLinkClass}>
            Settings
          </NavLink>
          <NavLink to="/workspace-admin/members" className={navLinkClass}>
            Members
          </NavLink>

          <div className="!mt-4 border-t border-[#E2E8F0] pt-3">
            <NavLink to="/" className={navLinkClass}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Platform Admin
            </NavLink>
          </div>
        </nav>
        <div className="border-t border-[#E2E8F0] p-3 space-y-0.5">
          <a
            href={MAIN_APP_URL}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[#62748E] hover:bg-[#F8FAFC] hover:text-[#0F172B]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to App
          </a>
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[#62748E] hover:bg-[#F8FAFC] hover:text-[#0F172B]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Content area */}
      <main className="flex-1 overflow-y-auto bg-[#F1F5F9] p-6">
        <Outlet />
      </main>
    </div>
  );
}
