import { Outlet, useNavigate, NavLink } from 'react-router-dom';

export default function MasterAdminLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-gray-950 text-white">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-gray-800 bg-gray-950">
        <div className="flex items-center gap-2 border-b border-gray-800 px-5 py-4">
          <h1 className="text-lg font-bold">SquadHub</h1>
          <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-[10px] font-medium text-yellow-400">Admin</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-white'
              }`
            }
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Dashboard
          </NavLink>
          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-white'
              }`
            }
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            Users
          </NavLink>
          <NavLink
            to="/admin/workspaces"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-white'
              }`
            }
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            Workspaces
          </NavLink>
        </nav>
        <div className="border-t border-gray-800 p-3">
          <button
            onClick={() => navigate('/')}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-900 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to App
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
