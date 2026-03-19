import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

const MAIN_APP_URL = import.meta.env.PROD ? 'http://72.61.245.97:3080' : 'http://localhost:5173';

export default function MasterAdminLayout() {
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="flex min-h-screen bg-[#0a0a0a] text-[#ededed]">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-[#222] bg-[#0a0a0a]">
        <div className="flex items-center gap-2 border-b border-[#222] px-5 py-4">
          <h1 className="text-lg font-semibold text-[#ededed]">SquadHub</h1>
          <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-medium text-yellow-400">Admin</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                isActive ? 'bg-[#1a1a1a] text-[#ededed]' : 'text-[#888] hover:bg-[#111] hover:text-[#ededed]'
              }`
            }
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Dashboard
          </NavLink>
          <NavLink
            to="/users"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                isActive ? 'bg-[#1a1a1a] text-[#ededed]' : 'text-[#888] hover:bg-[#111] hover:text-[#ededed]'
              }`
            }
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            Users
          </NavLink>
          <NavLink
            to="/workspaces"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                isActive ? 'bg-[#1a1a1a] text-[#ededed]' : 'text-[#888] hover:bg-[#111] hover:text-[#ededed]'
              }`
            }
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            Workspaces
          </NavLink>

          <div className="!mt-4 border-t border-[#222] pt-3">
            <NavLink
              to="/workspace-admin"
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                  isActive ? 'bg-[#1a1a1a] text-[#ededed]' : 'text-[#888] hover:bg-[#111] hover:text-[#ededed]'
                }`
              }
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Workspace Settings
            </NavLink>
          </div>
        </nav>
        <div className="border-t border-[#222] p-3 space-y-0.5">
          <a
            href={MAIN_APP_URL}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[#888] hover:bg-[#111] hover:text-[#ededed]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to App
          </a>
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[#888] hover:bg-[#111] hover:text-[#ededed]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Content area */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
